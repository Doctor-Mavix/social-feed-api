import type { Connection, QueryFilter } from 'mongoose';

import { isDuplicateKey } from '@core/database/mongo/errors';
import { keysetFilter, keysetSort } from '@core/database/mongo/keyset';
import type { CursorQuery } from '@core/database/pagination';
import type { FollowRepository } from '../follow.repository';
import type { Follow, NewFollow } from '../follow.types';
import { followModel } from './follow.schema';
import type { FollowDocument, FollowModel } from './follow.schema';

function toFollow(document: FollowDocument): Follow {
  return {
    id: document._id,
    followerId: document.followerId,
    followingId: document.followingId,
    createdAt: document.createdAt,
  };
}

export class MongoFollowRepository implements FollowRepository {
  private readonly follows: FollowModel;

  constructor(connection: Connection) {
    this.follows = followModel(connection);
  }

  async create(data: NewFollow): Promise<Follow | null> {
    try {
      const document = await this.follows.create({
        _id: data.id,
        followerId: data.followerId,
        followingId: data.followingId,
      });

      return toFollow(document.toObject());
    } catch (error) {
      if (isDuplicateKey(error)) {
        // Already following. Reported as "nothing happened" rather than as a conflict, so the
        // counter the caller maintains is not incremented twice.
        return null;
      }

      throw error;
    }
  }

  async remove(followerId: string, followingId: string): Promise<boolean> {
    const result = await this.follows.deleteOne({ followerId, followingId }).exec();

    return result.deletedCount > 0;
  }

  async exists(followerId: string, followingId: string): Promise<boolean> {
    const found = await this.follows.exists({ followerId, followingId }).exec();

    return found !== null;
  }

  async existingAmong(followerId: string, followingIds: readonly string[]): Promise<Set<string>> {
    if (followingIds.length === 0) {
      return new Set();
    }

    const documents = await this.follows
      .find({ followerId, followingId: { $in: [...followingIds] } })
      .select({ followingId: 1 })
      .lean<Pick<FollowDocument, '_id' | 'followingId'>[]>()
      .exec();

    return new Set(documents.map((document) => document.followingId));
  }

  async listFollowers(followingId: string, query: CursorQuery): Promise<Follow[]> {
    return this.page({ followingId }, query);
  }

  async listFollowing(followerId: string, query: CursorQuery): Promise<Follow[]> {
    return this.page({ followerId }, query);
  }

  async followingIds(followerId: string, cap: number): Promise<string[]> {
    const documents = await this.follows
      .find({ followerId })
      .select({ followingId: 1 })
      .sort({ createdAt: -1, _id: -1 })
      .limit(cap)
      .lean<Pick<FollowDocument, '_id' | 'followingId'>[]>()
      .exec();

    return documents.map((document) => document.followingId);
  }

  async countFollowers(followingId: string): Promise<number> {
    return this.follows.countDocuments({ followingId }).exec();
  }

  async countFollowing(followerId: string): Promise<number> {
    return this.follows.countDocuments({ followerId }).exec();
  }

  private async page(
    scope: Partial<Pick<FollowDocument, 'followerId' | 'followingId'>>,
    query: CursorQuery,
  ): Promise<Follow[]> {
    const filter = {
      ...scope,
      ...keysetFilter(query.cursor, query.direction, 'createdAt'),
    } as QueryFilter<FollowDocument>;

    const documents = await this.follows
      .find(filter)
      .sort(keysetSort(query.direction, 'createdAt'))
      .limit(query.limit + 1)
      .lean<FollowDocument[]>()
      .exec();

    return documents.map(toFollow);
  }
}
