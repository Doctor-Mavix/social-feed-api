import type { Connection, Model } from 'mongoose';
import { Schema } from 'mongoose';

export interface ProfileDocument {
  _id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  avatarMediaId: string | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const profileSchema = new Schema<ProfileDocument>(
  {
    // The actor id, reused as the primary key: one account, one profile, and no join to
    // discover which is which.
    _id: { type: String, required: true },
    handle: { type: String, required: true },
    displayName: { type: String, required: true },
    bio: { type: String, default: null },
    location: { type: String, default: null },
    website: { type: String, default: null },
    avatarMediaId: { type: String, default: null },
    followerCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    postCount: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false, collection: 'profiles' },
);

// Handles are stored lower-cased by the service, so a plain unique index is enough to make
// "@aline" and "@Aline" the same person.
profileSchema.index({ handle: 1 }, { unique: true });
// The directory listing, and the shape every keyset page in this project uses: the sort key
// first, then `_id` as the tie-breaker two profiles created in the same millisecond need.
profileSchema.index({ createdAt: -1, _id: -1 });

export type ProfileModel = Model<ProfileDocument>;

export function profileModel(connection: Connection): ProfileModel {
  return connection.model<ProfileDocument>('Profile', profileSchema);
}
