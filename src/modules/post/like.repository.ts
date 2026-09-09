import type { InjectionToken } from 'tsyringe';

export interface LikeRepository {
  /** False when the edge already existed, so the counter is moved exactly once. */
  create(id: string, postId: string, actorId: string): Promise<boolean>;
  remove(postId: string, actorId: string): Promise<boolean>;
  /** Which of `postIds` the caller has liked — one query per page, not one per row. */
  likedAmong(actorId: string, postIds: readonly string[]): Promise<Set<string>>;
  countForPost(postId: string): Promise<number>;
  removeForPost(postId: string): Promise<void>;
}

export const LIKE_REPOSITORY = Symbol('LikeRepository') as InjectionToken<LikeRepository>;
