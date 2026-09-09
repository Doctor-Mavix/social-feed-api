import type { InjectionToken } from 'tsyringe';

import type { CursorQuery } from '@core/database/pagination';
import type { CounterDelta, NewProfile, Profile, ProfilePatch } from './profile.types';

export interface ProfileRepository {
  create(data: NewProfile): Promise<Profile>;
  findById(id: string): Promise<Profile | null>;
  findByHandle(handle: string): Promise<Profile | null>;
  /**
   * Batch lookup. Rendering a page of posts needs the author of each one, and asking for them
   * one at a time is the N+1 that makes a feed slow no matter how good the index is.
   */
  findManyByIds(ids: readonly string[]): Promise<Profile[]>;
  update(id: string, patch: ProfilePatch): Promise<Profile | null>;
  /** Reads `limit + 1` rows, newest first, so the caller can answer `hasMore`. */
  list(query: CursorQuery): Promise<Profile[]>;
  /**
   * Relative, never absolute: two concurrent follows must both be counted, and reading a
   * count into the application to write it back is exactly how one of them gets lost.
   */
  adjustCounters(id: string, delta: CounterDelta): Promise<void>;
  /** Rebuilds the denormalised counters from the edges themselves. */
  setCounters(id: string, counters: Required<CounterDelta>): Promise<void>;
}

export const PROFILE_REPOSITORY = Symbol('ProfileRepository') as InjectionToken<ProfileRepository>;
