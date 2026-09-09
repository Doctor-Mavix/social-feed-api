import type { Connection, QueryFilter } from 'mongoose';

import {
  compositeKeysetFilter,
  compositeKeysetSort,
  compositeSortKey,
} from '@core/database/mongo/keyset';
import type { CursorQuery } from '@core/database/pagination';
import type { PostRepository } from '../post.repository';
import type { NewPost, Post, PostCounterDelta } from '../post.types';
import { postModel } from './post.schema';
import type { PostDocument, PostModel } from './post.schema';

function toPost(document: PostDocument): Post {
  return {
    id: document._id,
    authorId: document.authorId,
    text: document.text,
    imageIds: document.imageIds,
    likeCount: document.likeCount,
    commentCount: document.commentCount,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export class MongoPostRepository implements PostRepository {
  private readonly posts: PostModel;

  constructor(connection: Connection) {
    this.posts = postModel(connection);
  }

  async create(data: NewPost): Promise<Post> {
    // The timestamp is taken here rather than left to Mongoose because `feedKey` has to agree
    // with it exactly; a key built from a different instant would order the row against itself.
    const now = new Date();
    const document = new this.posts({
      _id: data.id,
      authorId: data.authorId,
      text: data.text,
      feedKey: compositeSortKey(now, data.id),
      createdAt: now,
      updatedAt: now,
    });

    await document.save({ timestamps: false });

    return toPost(document.toObject());
  }

  async findById(id: string): Promise<Post | null> {
    const document = await this.posts.findById(id).lean<PostDocument>().exec();

    return document === null ? null : toPost(document);
  }

  async findManyByIds(ids: readonly string[]): Promise<Post[]> {
    if (ids.length === 0) {
      return [];
    }

    const documents = await this.posts
      .find({ _id: { $in: [...ids] } })
      .lean<PostDocument[]>()
      .exec();

    return documents.map(toPost);
  }

  async listByAuthor(authorId: string, query: CursorQuery): Promise<Post[]> {
    return this.page({ authorId }, query);
  }

  async listByAuthors(authorIds: readonly string[], query: CursorQuery): Promise<Post[]> {
    if (authorIds.length === 0) {
      return [];
    }

    return this.page({ authorId: { $in: [...authorIds] } }, query);
  }

  async attachImages(id: string, imageIds: readonly string[]): Promise<Post | null> {
    const document = await this.posts
      .findByIdAndUpdate(
        id,
        { $push: { imageIds: { $each: [...imageIds] } } },
        { returnDocument: 'after' },
      )
      .lean<PostDocument>()
      .exec();

    return document === null ? null : toPost(document);
  }

  async adjustCounters(id: string, delta: PostCounterDelta): Promise<void> {
    const inc: Record<string, number> = {};

    if (delta.likeCount !== undefined) inc['likeCount'] = delta.likeCount;
    if (delta.commentCount !== undefined) inc['commentCount'] = delta.commentCount;

    if (Object.keys(inc).length === 0) {
      return;
    }

    await this.posts.updateOne({ _id: id }, { $inc: inc }).exec();
  }

  async setLikeCount(id: string, likeCount: number): Promise<void> {
    await this.posts.updateOne({ _id: id }, { $set: { likeCount } }).exec();
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.posts
      .updateOne({ _id: id }, { $set: { deletedAt: new Date() } })
      .exec();

    return result.modifiedCount > 0;
  }

  async countByAuthor(authorId: string): Promise<number> {
    return this.posts.countDocuments({ authorId }).exec();
  }

  private async page(scope: Record<string, unknown>, query: CursorQuery): Promise<Post[]> {
    const filter = {
      ...scope,
      ...compositeKeysetFilter(query.cursor, query.direction, 'feedKey'),
    } as QueryFilter<PostDocument>;

    const documents = await this.posts
      .find(filter)
      .sort(compositeKeysetSort(query.direction, 'feedKey'))
      .limit(query.limit + 1)
      .lean<PostDocument[]>()
      .exec();

    return documents.map(toPost);
  }
}
