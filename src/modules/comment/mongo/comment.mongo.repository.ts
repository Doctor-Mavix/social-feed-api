import type { Connection, QueryFilter } from 'mongoose';

import { keysetFilter, keysetSort } from '@core/database/mongo/keyset';
import type { CursorQuery } from '@core/database/pagination';
import type { CommentRepository } from '../comment.repository';
import type { Comment, NewComment } from '../comment.types';
import { commentModel } from './comment.schema';
import type { CommentDocument, CommentModel } from './comment.schema';

function toComment(document: CommentDocument): Comment {
  return {
    id: document._id,
    postId: document.postId,
    authorId: document.authorId,
    text: document.text,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoCommentRepository implements CommentRepository {
  private readonly comments: CommentModel;

  constructor(connection: Connection) {
    this.comments = commentModel(connection);
  }

  async create(data: NewComment): Promise<Comment> {
    const document = await this.comments.create({
      _id: data.id,
      postId: data.postId,
      authorId: data.authorId,
      text: data.text,
    });

    return toComment(document.toObject());
  }

  async findById(id: string): Promise<Comment | null> {
    const document = await this.comments.findById(id).lean<CommentDocument>().exec();

    return document === null ? null : toComment(document);
  }

  async listForPost(postId: string, query: CursorQuery): Promise<Comment[]> {
    const filter = {
      postId,
      ...keysetFilter(query.cursor, query.direction, 'createdAt'),
    } as QueryFilter<CommentDocument>;

    const documents = await this.comments
      .find(filter)
      .sort(keysetSort(query.direction, 'createdAt'))
      .limit(query.limit + 1)
      .lean<CommentDocument[]>()
      .exec();

    return documents.map(toComment);
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.comments
      .updateOne({ _id: id }, { $set: { deletedAt: new Date() } })
      .exec();

    return result.modifiedCount > 0;
  }

  async countForPost(postId: string): Promise<number> {
    return this.comments.countDocuments({ postId }).exec();
  }
}
