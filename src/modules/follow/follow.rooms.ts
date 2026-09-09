import { inject, injectable } from 'tsyringe';

import type { SocketIdentity, SocketRoomSource } from '@shared/realtime/realtime.types';
import { rooms } from '@shared/realtime/realtime.types';
import { FOLLOW_REPOSITORY } from './follow.repository';
import type { FollowRepository } from './follow.repository';
import { FEED_FANOUT_CAP } from './follow.service';

/**
 * Subscribes a socket to the accounts it follows, so publishing a new post costs one emit
 * instead of one per follower. The same cap as the feed applies: a socket that joined ten
 * thousand rooms would make every broadcast walk them.
 *
 * The graph is read once, at connect time, so following someone new only takes effect on the
 * next connection. That is the price of not maintaining a live subscription per edge, and it is
 * acceptable because the REST response already tells the client about the follow.
 */
@injectable()
export class FollowRoomSource implements SocketRoomSource {
  constructor(@inject(FOLLOW_REPOSITORY) private readonly repository: FollowRepository) {}

  async roomsFor(identity: SocketIdentity): Promise<readonly string[]> {
    const following = await this.repository.followingIds(identity.actorId, FEED_FANOUT_CAP);

    // The actor's own author room too: a client shows its own post appearing like any other.
    return [identity.actorId, ...following].map((id) => rooms.entity('author', id));
  }
}
