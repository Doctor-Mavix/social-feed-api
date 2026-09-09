import { inject, injectable } from 'tsyringe';

import { TOKENS } from '@core/container/tokens';
import { buildCursorPage } from '@core/database/pagination';
import type { CursorPage, CursorQuery } from '@core/database/pagination';
import { ForbiddenError, NotFoundError } from '@core/errors/app-error';
import type { Logger } from '@core/logger/logger';
import { POST_REPOSITORY } from '@modules/post/post.repository';
import type { PostRepository } from '@modules/post/post.repository';
import { PostService } from '@modules/post/post.service';
import { ProfileService } from '@modules/profile/profile.service';
import { toAuthorView } from '@modules/profile/profile.view';
import type { NotificationService } from '@shared/notifications/notification.service';
import { NOTIFICATION_SERVICE } from '@shared/notifications/notification.tokens';
import type { RealtimeGateway } from '@shared/realtime/realtime.types';
import { rooms } from '@shared/realtime/realtime.types';
import { SHARED_TOKENS } from '@shared/tokens';
import type { I18nService } from '@shared/utils-services/i18n.service';
import type { IdService } from '@shared/utils-services/id.service';
import { COMMENT_REPOSITORY } from './comment.repository';
import type { CommentRepository } from './comment.repository';
import type { CreateCommentInput } from './comment.schemas';
import type { Comment } from './comment.types';
import { toCommentView } from './comment.view';
import type { CommentView } from './comment.view';

const EXCERPT_LENGTH = 140;

@injectable()
export class CommentService {
  constructor(
    @inject(COMMENT_REPOSITORY) private readonly repository: CommentRepository,
    @inject(POST_REPOSITORY) private readonly posts: PostRepository,
    @inject(PostService) private readonly postService: PostService,
    @inject(ProfileService) private readonly profiles: ProfileService,
    @inject(NOTIFICATION_SERVICE) private readonly notifications: NotificationService,
    @inject(SHARED_TOKENS.Realtime) private readonly realtime: RealtimeGateway,
    @inject(SHARED_TOKENS.I18n) private readonly i18n: I18nService,
    @inject(SHARED_TOKENS.Id) private readonly ids: IdService,
    @inject(TOKENS.Logger) private readonly logger: Logger,
  ) {}

  async create(actorId: string, postId: string, input: CreateCommentInput): Promise<Comment> {
    const author = await this.profiles.requireOwn(actorId);
    const post = await this.postService.require(postId);

    const comment = await this.repository.create({
      id: this.ids.uuid(),
      postId: post.id,
      authorId: author.id,
      text: input.text,
    });

    await this.posts.adjustCounters(post.id, { commentCount: 1 });

    const excerpt = comment.text.slice(0, EXCERPT_LENGTH);

    this.realtime.emitTo(rooms.entity('author', post.authorId), 'post.commented', {
      postId: post.id,
      commentId: comment.id,
      authorId: author.id,
      authorHandle: author.handle,
      excerpt,
      createdAt: comment.createdAt.toISOString(),
    });

    // Commenting on your own post is not news to you.
    if (post.authorId !== author.id) {
      await this.announce(post.authorId, author.displayName, excerpt, post.id, comment.id);
    }

    return comment;
  }

  async list(postId: string, query: CursorQuery): Promise<CursorPage<Comment>> {
    await this.postService.require(postId);

    const rows = await this.repository.listForPost(postId, query);

    return buildCursorPage(rows, query.limit, (comment) => ({
      value: comment.createdAt.toISOString(),
      id: comment.id,
    }));
  }

  /** The comment's author may delete it, and so may the author of the post being commented on. */
  async remove(actorId: string, id: string): Promise<void> {
    const comment = await this.repository.findById(id);

    if (comment === null) {
      throw new NotFoundError('This comment does not exist');
    }

    const post = await this.postService.require(comment.postId);

    if (comment.authorId !== actorId && post.authorId !== actorId) {
      throw new ForbiddenError('You cannot delete this comment');
    }

    if (await this.repository.softDelete(id)) {
      await this.posts.adjustCounters(comment.postId, { commentCount: -1 });
    }
  }

  async views(comments: readonly Comment[]): Promise<CommentView[]> {
    const authors = await this.profiles.authorViews(comments.map((comment) => comment.authorId));

    return comments.map((comment) =>
      toCommentView(
        comment,
        authors.get(comment.authorId) ?? toAuthorView(undefined, comment.authorId),
      ),
    );
  }

  async view(comment: Comment): Promise<CommentView> {
    const [only] = await this.views([comment]);

    if (only === undefined) {
      throw new NotFoundError('This comment does not exist');
    }

    return only;
  }

  private async announce(
    recipientId: string,
    authorName: string,
    excerpt: string,
    postId: string,
    commentId: string,
  ): Promise<void> {
    try {
      await this.notifications.notify({
        recipient: { actorId: recipientId },
        type: 'comment.created',
        title: this.i18n.translate('notification.comment.created.title'),
        body: this.i18n.translate('notification.comment.created.body', { authorName, excerpt }),
        data: { postId, commentId },
        channels: ['in_app'],
      });
    } catch (error) {
      // The comment is written; failing the request because the inbox was down would invite a
      // retry that posts it twice.
      this.logger.warn({ err: error, postId }, 'could not announce a new comment');
    }
  }
}
