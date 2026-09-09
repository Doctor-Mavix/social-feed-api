import type { Server as HttpServer } from 'node:http';

/**
 * The one contract shared by the server and every client. Adding an event here is what makes
 * it typed on both sides; emitting a string the map does not know is a compile error.
 */
export interface RealtimeEvents {
  'notification.created': {
    id: string;
    type: string;
    title: string;
    body: string;
    createdAt: string;
  };
  // Sent to every follower of the author, which is why it carries enough to render a feed card
  // without a round trip: a client that has to fetch the post it was just told about would
  // stampede the API each time a popular account publishes.
  'post.created': {
    id: string;
    authorId: string;
    authorHandle: string;
    excerpt: string;
    imageCount: number;
    createdAt: string;
  };
  // The counter, not the event: likes are debounced through Redis, so a client that missed a
  // frame still converges on the right number instead of accumulating increments.
  'post.likes-changed': {
    postId: string;
    likeCount: number;
  };
  'post.commented': {
    postId: string;
    commentId: string;
    authorId: string;
    authorHandle: string;
    excerpt: string;
    createdAt: string;
  };
  'follow.created': {
    followerId: string;
    followerHandle: string;
    followingId: string;
    createdAt: string;
  };
  'media.processed': {
    id: string;
    ownerType: string;
    ownerId: string;
    variants: readonly string[];
  };
}

export type RealtimeEvent = keyof RealtimeEvents;

/** Rooms follow one convention so a service never has to guess a room name. */
export const rooms = {
  actor: (actorId: string): string => `actor:${actorId}`,
  role: (role: string): string => `role:${role}`,
  entity: (module: string, entityId: string): string => `module:${module}:${entityId}`,
} as const;

export interface SocketIdentity {
  actorId: string;
  roles: readonly string[];
}

/**
 * Lets a business module widen what a socket listens to at connect time. Without it every
 * "something happened to an account you follow" event costs one publish per follower, which is
 * the fan-out the feed exists to avoid; with it the author publishes once to its own room and
 * the followers are already in it.
 *
 * Consulted during the handshake, so it must be cheap and must not throw for a normal identity:
 * a failure here refuses the connection.
 */
export interface SocketRoomSource {
  roomsFor(identity: SocketIdentity): Promise<readonly string[]>;
}

/** Implemented by the auth module; the kit only knows how to ask. */
export interface SocketAuthenticator {
  authenticate(handshake: {
    token: string | undefined;
    actorId: string | undefined;
  }): Promise<SocketIdentity | null>;
}

export interface RealtimeGateway {
  attach(server: HttpServer): Promise<void>;
  emitTo<TEvent extends RealtimeEvent>(
    room: string,
    event: TEvent,
    payload: RealtimeEvents[TEvent],
  ): void;
  close(): Promise<void>;
}
