import { inject, injectable } from 'tsyringe';

import { TOKENS } from '@core/container/tokens';
import { buildCursorPage } from '@core/database/pagination';
import type { CursorPage, CursorQuery } from '@core/database/pagination';
import { BadRequestError, ForbiddenError, NotFoundError } from '@core/errors/app-error';
import type { Logger } from '@core/logger/logger';
import { ProfileService } from '@modules/profile/profile.service';
import { toAuthorView } from '@modules/profile/profile.view';
import type { MediaService, UploadedFile } from '@shared/media/media.service';
import type { RealtimeGateway } from '@shared/realtime/realtime.types';
import { rooms } from '@shared/realtime/realtime.types';
import { SHARED_TOKENS } from '@shared/tokens';
import type { IdService } from '@shared/utils-services/id.service';
import { LikeCounter } from './like-counter';
import { LIKE_REPOSITORY } from './like.repository';
import type { LikeRepository } from './like.repository';
import { POST_REPOSITORY } from './post.repository';
import type { PostRepository } from './post.repository';
import { MAX_POST_IMAGES } from './post.schemas';
import type { CreatePostInput } from './post.schemas';
import type { Post } from './post.types';
import { toPostView } from './post.view';
import type { PostView } from './post.view';

/** Owner type under which post pictures are filed in the media kit. */
export const POST_IMAGE_OWNER = 'post-image';

/** The excerpt carried by the realtime event, long enough to render a card, short enough to push. */
const EXCERPT_LENGTH = 140;

@injectable()
export class PostService {
  constructor(
    @inject(POST_REPOSITORY) private readonly repository: PostRepository,
    @inject(LIKE_REPOSITORY) private readonly likes: LikeRepository,
    @inject(LikeCounter) private readonly counter: LikeCounter,
    @inject(ProfileService) private readonly profiles: ProfileService,
    @inject(SHARED_TOKENS.Media) private readonly media: MediaService,
    @inject(SHARED_TOKENS.Realtime) private readonly realtime: RealtimeGateway,
    @inject(SHARED_TOKENS.Id) private readonly ids: IdService,
    @inject(TOKENS.Logger) private readonly logger: Logger,
  ) {}

  async create(
    actorId: string,
    input: CreatePostInput,
    files: readonly UploadedFile[],
  ): Promise<Post> {
    const author = await this.profiles.requireOwn(actorId);

    if (files.length > MAX_POST_IMAGES) {
      throw new BadRequestError(`A post carries at most ${String(MAX_POST_IMAGES)} images`);
    }

    const post = await this.repository.create({
      id: this.ids.uuid(),
      authorId: author.id,
      text: input.text,
    });

    // Uploaded after the row exists so the storage key can be filed under the post, and
    // sequentially so the ids keep the order the author chose.
    const imageIds: string[] = [];

    for (const file of files) {
      const uploaded = await this.media.upload(POST_IMAGE_OWNER, post.id, file);
      imageIds.push(uploaded.id);
    }

    const withImages =
      imageIds.length === 0
        ? post
        : ((await this.repository.attachImages(post.id, imageIds)) ?? post);

    await this.profiles.adjustCounters(author.id, { postCount: 1 });

    // One publish for the whole audience: the followers are already in the author's room, which
    // is the entire point of the room source registered by the follow module.
    this.realtime.emitTo(rooms.entity('author', author.id), 'post.created', {
      id: withImages.id,
      authorId: author.id,
      authorHandle: author.handle,
      excerpt: withImages.text.slice(0, EXCERPT_LENGTH),
      imageCount: withImages.imageIds.length,
      createdAt: withImages.createdAt.toISOString(),
    });

    return withImages;
  }

  async require(id: string): Promise<Post> {
    const post = await this.repository.findById(id);

    if (post === null) {
      throw new NotFoundError('This post does not exist');
    }

    return post;
  }

  async remove(actorId: string, id: string): Promise<void> {
    const post = await this.require(id);

    if (post.authorId !== actorId) {
      throw new ForbiddenError('You can only delete your own posts');
    }

    await this.repository.softDelete(id);
    await this.profiles.adjustCounters(post.authorId, { postCount: -1 });

    // The edges go, the counter key goes with them: leaving it would resurrect the old total
    // if the post ever came back, and it is the one piece of state Redis cannot re-derive.
    await this.likes.removeForPost(id);
    await this.counter.forget(id);

    for (const imageId of post.imageIds) {
      try {
        await this.media.remove(imageId);
      } catch (error) {
        this.logger.warn({ err: error, imageId }, 'could not remove a post image');
      }
    }
  }

  async listByAuthor(handle: string, query: CursorQuery): Promise<CursorPage<Post>> {
    const author = await this.profiles.requireByHandle(handle);
    const rows = await this.repository.listByAuthor(author.id, query);

    return PostService.page(rows, query);
  }

  async like(actorId: string, postId: string): Promise<{ liked: boolean; likeCount: number }> {
    const post = await this.require(postId);
    const created = await this.likes.create(this.ids.uuid(), postId, actorId);

    // `liked` is the state after the call, always true here; `created` only decides whether the
    // counter moves. Conflating the two is what makes a double tap answer "not liked".
    return this.settle(post, true, created ? 1 : 0);
  }

  async unlike(actorId: string, postId: string): Promise<{ liked: boolean; likeCount: number }> {
    const post = await this.require(postId);
    const removed = await this.likes.remove(postId, actorId);

    return this.settle(post, false, removed ? -1 : 0);
  }

  /**
   * Views for a page of posts: one profile batch, one presign batch, one `MGET`, one liked-set
   * query — four round trips whatever the page size, which is what keeps the feed flat.
   */
  async views(posts: readonly Post[], viewerId: string | null): Promise<PostView[]> {
    if (posts.length === 0) {
      return [];
    }

    const ids = posts.map((post) => post.id);
    const [authors, images, counts, liked] = await Promise.all([
      this.profiles.authorViews(posts.map((post) => post.authorId)),
      this.media.presignMany(posts.flatMap((post) => post.imageIds)),
      this.counter.many(posts),
      viewerId === null ? Promise.resolve(null) : this.likes.likedAmong(viewerId, ids),
    ]);

    return posts.map((post) =>
      toPostView(
        post,
        authors.get(post.authorId) ?? toAuthorView(undefined, post.authorId),
        post.imageIds.flatMap((imageId) => {
          const signed = images.get(imageId);

          // A picture whose row was deleted is skipped rather than rendered as a hole.
          return signed === undefined
            ? []
            : [{ id: imageId, original: signed.original, ...signed.variants }];
        }),
        counts.get(post.id) ?? post.likeCount,
        liked === null ? null : liked.has(post.id),
      ),
    );
  }

  async view(post: Post, viewerId: string | null): Promise<PostView> {
    const [only] = await this.views([post], viewerId);

    if (only === undefined) {
      throw new NotFoundError('This post does not exist');
    }

    return only;
  }

  static page(rows: readonly Post[], query: CursorQuery): CursorPage<Post> {
    return buildCursorPage(rows, query.limit, (post) => ({
      value: post.createdAt.toISOString(),
      id: post.id,
    }));
  }

  /**
   * Redis moves first because it is what every reader sees; MongoDB follows because it is what
   * Redis is rebuilt from. A crash between the two leaves the durable copy one behind, and the
   * edges — the actual source of truth — are already right, so `pnpm db:recount` fixes it.
   */
  private async settle(
    post: Post,
    liked: boolean,
    delta: number,
  ): Promise<{ liked: boolean; likeCount: number }> {
    if (delta === 0) {
      const counts = await this.counter.many([post]);

      return { liked, likeCount: counts.get(post.id) ?? post.likeCount };
    }

    // Seeded first, or an `INCRBY` on a missing key would start this post's count at the delta
    // and silently discard every like it had before the key expired.
    await this.counter.seed([post]);

    const likeCount = await this.counter.adjust(post.id, delta);

    await this.repository.adjustCounters(post.id, { likeCount: delta });

    this.realtime.emitTo(rooms.entity('author', post.authorId), 'post.likes-changed', {
      postId: post.id,
      likeCount,
    });

    return { liked, likeCount };
  }
}
