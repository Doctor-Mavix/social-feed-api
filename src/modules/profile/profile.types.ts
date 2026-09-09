export interface Profile {
  /** The actor id. A profile is the public face of an account, not a separate identity. */
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  avatarMediaId: string | null;
  /**
   * Denormalised counters. A social profile is read far more often than it is written, and
   * counting followers on every page view means scanning an edge collection that grows without
   * bound. They are maintained by the follow and post modules through `adjustCounters`.
   */
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  location: string | null;
  website: string | null;
}

export interface ProfilePatch {
  handle?: string;
  displayName?: string;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  avatarMediaId?: string | null;
}

export interface CounterDelta {
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
}
