import { inject, injectable } from 'tsyringe';

import type { CursorPage, CursorQuery } from '@core/database/pagination';
import { FollowService } from '@modules/follow/follow.service';
import { POST_REPOSITORY } from '@modules/post/post.repository';
import type { PostRepository } from '@modules/post/post.repository';
import { PostService } from '@modules/post/post.service';
import type { Post } from '@modules/post/post.types';
import { ProfileService } from '@modules/profile/profile.service';

/**
 * Fan-out on read: the feed is computed when it is asked for, from the graph and the posts, and
 * nothing is duplicated per follower.
 *
 * The alternative — fan-out on write, a materialised timeline row per follower per post — makes
 * the read a single range scan but turns one publish by a popular account into a million writes,
 * and makes a new follow a backfill. At this size the read side wins: the query is one index
 * range per followed author, merged by MongoDB, and the keyset means page 500 costs what page 1
 * costs. What it does not survive is an account following tens of thousands of others, which is
 * what `FEED_FANOUT_CAP` states out loud instead of discovering in production.
 */
@injectable()
export class FeedService {
  constructor(
    @inject(POST_REPOSITORY) private readonly posts: PostRepository,
    @inject(FollowService) private readonly follows: FollowService,
    @inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  /** The home timeline: the posts of the accounts this actor follows, plus their own. */
  async home(actorId: string, query: CursorQuery): Promise<CursorPage<Post>> {
    await this.profiles.requireOwn(actorId);

    const authorIds = await this.follows.feedAuthorIds(actorId);
    const rows = await this.posts.listByAuthors(authorIds, query);

    return PostService.page(rows, query);
  }
}
