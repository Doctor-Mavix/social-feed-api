import type { Connection, QueryFilter, UpdateQuery } from 'mongoose';

import { isDuplicateKey } from '@core/database/mongo/errors';
import { keysetFilter, keysetSort } from '@core/database/mongo/keyset';
import type { CursorQuery } from '@core/database/pagination';
import { ConflictError } from '@core/errors/app-error';
import type { ProfileRepository } from '../profile.repository';
import type { CounterDelta, NewProfile, Profile, ProfilePatch } from '../profile.types';
import { profileModel } from './profile.schema';
import type { ProfileDocument, ProfileModel } from './profile.schema';

function toProfile(document: ProfileDocument): Profile {
  return {
    id: document._id,
    handle: document.handle,
    displayName: document.displayName,
    bio: document.bio,
    location: document.location,
    website: document.website,
    avatarMediaId: document.avatarMediaId,
    followerCount: document.followerCount,
    followingCount: document.followingCount,
    postCount: document.postCount,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toUpdate(patch: ProfilePatch): UpdateQuery<ProfileDocument> {
  const set: Partial<ProfileDocument> = {};

  if (patch.handle !== undefined) set.handle = patch.handle;
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.bio !== undefined) set.bio = patch.bio;
  if (patch.location !== undefined) set.location = patch.location;
  if (patch.website !== undefined) set.website = patch.website;
  if (patch.avatarMediaId !== undefined) set.avatarMediaId = patch.avatarMediaId;

  return { $set: set };
}

export class MongoProfileRepository implements ProfileRepository {
  private readonly profiles: ProfileModel;

  constructor(connection: Connection) {
    this.profiles = profileModel(connection);
  }

  async create(data: NewProfile): Promise<Profile> {
    try {
      const document = await this.profiles.create({
        _id: data.id,
        handle: data.handle,
        displayName: data.displayName,
        bio: data.bio,
        location: data.location,
        website: data.website,
      });

      return toProfile(document.toObject());
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictError('This handle is already taken', { cause: error });
      }

      throw error;
    }
  }

  async findById(id: string): Promise<Profile | null> {
    const document = await this.profiles.findById(id).lean<ProfileDocument>().exec();

    return document === null ? null : toProfile(document);
  }

  async findByHandle(handle: string): Promise<Profile | null> {
    const document = await this.profiles.findOne({ handle }).lean<ProfileDocument>().exec();

    return document === null ? null : toProfile(document);
  }

  async findManyByIds(ids: readonly string[]): Promise<Profile[]> {
    if (ids.length === 0) {
      return [];
    }

    const documents = await this.profiles
      .find({ _id: { $in: [...ids] } })
      .lean<ProfileDocument[]>()
      .exec();

    return documents.map(toProfile);
  }

  async update(id: string, patch: ProfilePatch): Promise<Profile | null> {
    try {
      const document = await this.profiles
        .findByIdAndUpdate(id, toUpdate(patch), { returnDocument: 'after' })
        .lean<ProfileDocument>()
        .exec();

      return document === null ? null : toProfile(document);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictError('This handle is already taken', { cause: error });
      }

      throw error;
    }
  }

  async list(query: CursorQuery): Promise<Profile[]> {
    const documents = await this.profiles
      .find(
        keysetFilter(query.cursor, query.direction, 'createdAt') as QueryFilter<ProfileDocument>,
      )
      .sort(keysetSort(query.direction, 'createdAt'))
      .limit(query.limit + 1)
      .lean<ProfileDocument[]>()
      .exec();

    return documents.map(toProfile);
  }

  async adjustCounters(id: string, delta: CounterDelta): Promise<void> {
    const inc: Record<string, number> = {};

    if (delta.followerCount !== undefined) inc['followerCount'] = delta.followerCount;
    if (delta.followingCount !== undefined) inc['followingCount'] = delta.followingCount;
    if (delta.postCount !== undefined) inc['postCount'] = delta.postCount;

    if (Object.keys(inc).length === 0) {
      return;
    }

    await this.profiles.updateOne({ _id: id }, { $inc: inc }).exec();
  }

  async setCounters(id: string, counters: Required<CounterDelta>): Promise<void> {
    await this.profiles.updateOne({ _id: id }, { $set: counters }).exec();
  }
}
