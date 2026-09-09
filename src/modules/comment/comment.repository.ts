import type { InjectionToken } from 'tsyringe';

import type { CursorQuery } from '@core/database/pagination';
import type { Comment, NewComment } from './comment.types';

export interface CommentRepository {
  create(data: NewComment): Promise<Comment>;
  findById(id: string): Promise<Comment | null>;
  listForPost(postId: string, query: CursorQuery): Promise<Comment[]>;
  softDelete(id: string): Promise<boolean>;
  countForPost(postId: string): Promise<number>;
}

export const COMMENT_REPOSITORY = Symbol('CommentRepository') as InjectionToken<CommentRepository>;
