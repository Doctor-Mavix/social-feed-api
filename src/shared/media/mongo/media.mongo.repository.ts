import type { Connection } from 'mongoose';

import type { MediaRepository, NewMedia } from '../media.repository';
import type { Media, MediaStatus, MediaVariants } from '../media.types';
import { mediaModel } from './media.schema';
import type { MediaDocument, MediaModel } from './media.schema';

function toMedia(document: MediaDocument): Media {
  return {
    id: document._id,
    ownerType: document.ownerType,
    ownerId: document.ownerId,
    filename: document.filename,
    mimeType: document.mimeType,
    size: document.size,
    storageKey: document.storageKey,
    status: document.status,
    // Rows written before `minimize` was turned off have no `variants` key at all.
    variants: document.variants ?? {},
    createdAt: document.createdAt,
  };
}

export class MongoMediaRepository implements MediaRepository {
  private readonly model: MediaModel;

  constructor(connection: Connection) {
    this.model = mediaModel(connection);
  }

  async create(data: NewMedia): Promise<Media> {
    const created = await this.model.create({ ...data, _id: data.id });

    return toMedia(created.toObject());
  }

  async findById(id: string): Promise<Media | null> {
    const document = await this.model.findOne({ _id: id }).lean<MediaDocument | null>();

    return document === null ? null : toMedia(document);
  }

  async findManyByIds(ids: readonly string[]): Promise<Media[]> {
    if (ids.length === 0) {
      return [];
    }

    const documents = await this.model.find({ _id: { $in: [...ids] } }).lean<MediaDocument[]>();

    return documents.map(toMedia);
  }

  async listForOwner(ownerType: string, ownerId: string): Promise<Media[]> {
    const documents = await this.model
      .find({ ownerType, ownerId })
      .sort({ createdAt: 1 })
      .lean<MediaDocument[]>();

    return documents.map(toMedia);
  }

  async setVariants(
    id: string,
    status: MediaStatus,
    variants: MediaVariants,
  ): Promise<Media | null> {
    const document = await this.model
      .findOneAndUpdate({ _id: id }, { $set: { status, variants } }, { returnDocument: 'after' })
      .lean<MediaDocument | null>();

    return document === null ? null : toMedia(document);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ _id: id });

    return result.deletedCount > 0;
  }
}
