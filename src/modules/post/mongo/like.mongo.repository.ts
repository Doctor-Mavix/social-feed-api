import type { Connection } from 'mongoose';

import { isDuplicateKey } from '@core/database/mongo/errors';
import type { LikeRepository } from '../like.repository';
import { likeModel } from './like.schema';
import type { LikeDocument, LikeModel } from './like.schema';

export class MongoLikeRepository implements LikeRepository {
  private readonly likes: LikeModel;

  constructor(connection: Connection) {
    this.likes = likeModel(connection);
  }

  async create(id: string, postId: string, actorId: string): Promise<boolean> {
    try {
      await this.likes.create({ _id: id, postId, actorId });

      return true;
    } catch (error) {
      if (isDuplicateKey(error)) {
        return false;
      }

      throw error;
    }
  }

  async remove(postId: string, actorId: string): Promise<boolean> {
    const result = await this.likes.deleteOne({ postId, actorId }).exec();

    return result.deletedCount > 0;
  }

  async likedAmong(actorId: string, postIds: readonly string[]): Promise<Set<string>> {
    if (postIds.length === 0) {
      return new Set();
    }

    const documents = await this.likes
      .find({ actorId, postId: { $in: [...postIds] } })
      .select({ postId: 1 })
      .lean<Pick<LikeDocument, '_id' | 'postId'>[]>()
      .exec();

    return new Set(documents.map((document) => document.postId));
  }

  async countForPost(postId: string): Promise<number> {
    return this.likes.countDocuments({ postId }).exec();
  }

  async removeForPost(postId: string): Promise<void> {
    await this.likes.deleteMany({ postId }).exec();
  }
}
