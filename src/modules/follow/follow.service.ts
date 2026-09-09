import { inject, injectable } from 'tsyringe';

import { buildCursorPage } from '@core/database/pagination';
import type { CursorPage, CursorQuery } from '@core/database/pagination';
import { ConflictError } from '@core/errors/app-error';
import type { Logger } from '@core/logger/logger';
import { TOKENS } from '@core/container/tokens';
import { ProfileService } from '@modules/profile/profile.service';
import type { Profile } from '@modules/profile/profile.types';
import { NOTIFICATION_SERVICE } from '@shared/notifications/notification.tokens';
import type { NotificationService } from '@shared/notifications/notification.service';
import type { RealtimeGateway } from '@shared/realtime/realtime.types';
import { rooms } from '@shared/realtime/realtime.types';
import { SHARED_TOKENS } from '@shared/tokens';
import type { I18nService } from '@shared/utils-services/i18n.service';
import type { IdService } from '@shared/utils-services/id.service';
import { FOLLOW_REPOSITORY } from './follow.repository';
import type { FollowRepository } from './follow.repository';
import type { Follow } from './follow.types';

/**
 * How many accounts the feed will read for one person. Fan-out on read turns the graph into an
 * `$in`, and past a few thousand branches the planner stops merging index scans and starts
 * scanning. The cap is the honest edge of this design, not a limit on how many people may be
 * followed — see the README for what replaces it at that scale.
 */
export const FEED_FANOUT_CAP = 1000;

@injectable()
export class FollowService {
  constructor(
    @inject(FOLLOW_REPOSITORY) private readonly repository: FollowRepository,
    @inject(ProfileService) private readonly profiles: ProfileService,
    @inject(NOTIFICATION_SERVICE) private readonly notifications: NotificationService,
    @inject(SHARED_TOKENS.Realtime) private readonly realtime: RealtimeGateway,
    @inject(SHARED_TOKENS.I18n) private readonly i18n: I18nService,
    @inject(SHARED_TOKENS.Id) private readonly ids: IdService,
    @inject(TOKENS.Logger) private readonly logger: Logger,
  ) {}

  async follow(actorId: string, handle: string): Promise<{ following: boolean }> {
    const me = await this.profiles.requireOwn(actorId);
    const target = await this.profiles.requireByHandle(handle);

    if (target.id === me.id) {
      throw new ConflictError('You cannot follow yourself');
    }

    const edge = await this.repository.create({
      id: this.ids.uuid(),
      followerId: me.id,
      followingId: target.id,
    });

    // Already following: the counters are already right, and re-notifying would let anyone
    // spam an inbox by replaying the same request.
    if (edge === null) {
      return { following: true };
    }

    await Promise.all([
      this.profiles.adjustCounters(me.id, { followingCount: 1 }),
      this.profiles.adjustCounters(target.id, { followerCount: 1 }),
    ]);

    this.realtime.emitTo(rooms.actor(target.id), 'follow.created', {
      followerId: me.id,
      followerHandle: me.handle,
      followingId: target.id,
      createdAt: edge.createdAt.toISOString(),
    });

    await this.announce(me, target);

    return { following: true };
  }

  async unfollow(actorId: string, handle: string): Promise<{ following: boolean }> {
    const me = await this.profiles.requireOwn(actorId);
    const target = await this.profiles.requireByHandle(handle);
    const removed = await this.repository.remove(me.id, target.id);

    if (removed) {
      await Promise.all([
        this.profiles.adjustCounters(me.id, { followingCount: -1 }),
        this.profiles.adjustCounters(target.id, { followerCount: -1 }),
      ]);
    }

    return { following: false };
  }

  async listFollowers(handle: string, query: CursorQuery): Promise<CursorPage<Follow>> {
    const target = await this.profiles.requireByHandle(handle);
    const rows = await this.repository.listFollowers(target.id, query);

    return this.page(rows, query);
  }

  async listFollowing(handle: string, query: CursorQuery): Promise<CursorPage<Follow>> {
    const target = await this.profiles.requireByHandle(handle);
    const rows = await this.repository.listFollowing(target.id, query);

    return this.page(rows, query);
  }

  /** The authors the feed reads, plus the caller: your own posts belong in your own feed. */
  async feedAuthorIds(actorId: string): Promise<string[]> {
    const following = await this.repository.followingIds(actorId, FEED_FANOUT_CAP);

    return [actorId, ...following];
  }

  async followedAmong(actorId: string, ids: readonly string[]): Promise<Set<string>> {
    return this.repository.existingAmong(actorId, ids);
  }

  /** Recomputes a profile's graph counters from the edges. Used by the seeding script. */
  async recountGraph(profileId: string, postCount: number): Promise<void> {
    const [followerCount, followingCount] = await Promise.all([
      this.repository.countFollowers(profileId),
      this.repository.countFollowing(profileId),
    ]);

    await this.profiles.recount(profileId, { followerCount, followingCount, postCount });
  }

  private page(rows: readonly Follow[], query: CursorQuery): CursorPage<Follow> {
    return buildCursorPage(rows, query.limit, (follow) => ({
      value: follow.createdAt.toISOString(),
      id: follow.id,
    }));
  }

  private async announce(follower: Profile, target: Profile): Promise<void> {
    try {
      // In-app only, so no address is needed: a new follower is not worth an email, and asking
      // for one would couple this module to the auth repository to resolve it.
      await this.notifications.notify({
        recipient: { actorId: target.id },
        type: 'follow.created',
        title: this.i18n.translate('notification.follow.created.title'),
        body: this.i18n.translate('notification.follow.created.body', {
          followerName: follower.displayName,
          followerHandle: follower.handle,
        }),
        data: { followerId: follower.id, followerHandle: follower.handle },
        channels: ['in_app'],
      });
    } catch (error) {
      // A follow that succeeded must not be reported as failed because the inbox was down.
      this.logger.warn({ err: error, target: target.id }, 'could not announce a new follower');
    }
  }
}
