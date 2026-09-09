import type { Connection, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { MEDIA_STATUSES } from '../media.types';
import type { MediaStatus, MediaVariants } from '../media.types';

export interface MediaDocument {
  _id: string;
  ownerType: string;
  ownerId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  status: MediaStatus;
  /** Optional here, never on the domain type: rows written before `minimize` was turned off. */
  variants?: MediaVariants;
  createdAt: Date;
  updatedAt: Date;
}

const mediaSchema = new Schema<MediaDocument>(
  {
    _id: { type: String, required: true },
    ownerType: { type: String, required: true },
    ownerId: { type: String, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storageKey: { type: String, required: true },
    status: { type: String, enum: [...MEDIA_STATUSES], default: 'pending' },
    variants: { type: Schema.Types.Mixed, default: {} },
  },
  // `minimize` off because Mongoose otherwise strips an empty object before writing it: a row
  // created before its variants exist would be stored with no `variants` field at all, and any
  // read landing in that window — the upload response is one — gets `undefined` where the type
  // promises a map.
  { timestamps: true, versionKey: false, collection: 'media', minimize: false },
);

mediaSchema.index({ ownerType: 1, ownerId: 1, createdAt: 1 });

export type MediaModel = Model<MediaDocument>;

export function mediaModel(connection: Connection): MediaModel {
  return connection.model<MediaDocument>('Media', mediaSchema);
}
