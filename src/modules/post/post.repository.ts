import type { InjectionToken } from 'tsyringe';

import type { CursorQuery } from '@core/database/pagination';
import type { NewPost, Post, PostCounterDelta } from './post.types';

export interface PostRepository {
  create(data: NewPost): Promise<Post>;
  findById(id: string): Promise<Post | null>;
  findManyByIds(ids: readonly string[]): Promise<Post[]>;
  /** One author's posts, newest first. */
  listByAuthor(authorId: string, query: CursorQuery): Promise<Post[]>;
  /**
   * The feed query: the posts of several authors merged into one keyset page. Takes the whole
   * author list rather than being called once per author, so MongoDB merges the index ranges
   * instead of the application merging pages in memory.
   */
  listByAuthors(authorIds: readonly string[], query: CursorQuery): Promise<Post[]>;
  attachImages(id: string, imageIds: readonly string[]): Promise<Post | null>;
  adjustCounters(id: string, delta: PostCounterDelta): Promise<void>;
  setLikeCount(id: string, likeCount: number): Promise<void>;
  softDelete(id: string): Promise<boolean>;
  countByAuthor(authorId: string): Promise<number>;
}

export const POST_REPOSITORY = Symbol('PostRepository') as InjectionToken<PostRepository>;
