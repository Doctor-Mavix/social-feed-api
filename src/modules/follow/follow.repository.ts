import type { InjectionToken } from 'tsyringe';

import type { CursorQuery } from '@core/database/pagination';
import type { Follow, NewFollow } from './follow.types';

export interface FollowRepository {
  /** Returns null when the edge already exists, so a double follow is a no-op, not an error. */
  create(data: NewFollow): Promise<Follow | null>;
  remove(followerId: string, followingId: string): Promise<boolean>;
  exists(followerId: string, followingId: string): Promise<boolean>;
  /** Which of `followingIds` the caller already follows — one query for a whole page. */
  existingAmong(followerId: string, followingIds: readonly string[]): Promise<Set<string>>;
  listFollowers(followingId: string, query: CursorQuery): Promise<Follow[]>;
  listFollowing(followerId: string, query: CursorQuery): Promise<Follow[]>;
  /**
   * Every account the caller follows, capped. The feed turns this into an `$in`, and an
   * unbounded list would build a query the planner cannot serve.
   */
  followingIds(followerId: string, cap: number): Promise<string[]>;
  countFollowers(followingId: string): Promise<number>;
  countFollowing(followerId: string): Promise<number>;
}

export const FOLLOW_REPOSITORY = Symbol('FollowRepository') as InjectionToken<FollowRepository>;
