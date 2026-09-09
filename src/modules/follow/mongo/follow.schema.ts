import type { Connection, Model } from 'mongoose';
import { Schema } from 'mongoose';

export interface FollowDocument {
  _id: string;
  followerId: string;
  followingId: string;
  createdAt: Date;
}

const followSchema = new Schema<FollowDocument>(
  {
    _id: { type: String, required: true },
    followerId: { type: String, required: true },
    followingId: { type: String, required: true },
  },
  // No `updatedAt`: an edge is created or destroyed, never modified.
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'follows',
  },
);

// The edge itself. Unique, so following twice is rejected by the database rather than by a
// read-then-write in the service, which two concurrent requests would both pass.
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
// "Who follows me", newest first. The tie-breaker on `_id` is what makes the keyset exact.
followSchema.index({ followingId: 1, createdAt: -1, _id: -1 });
// "Who I follow" — also the index the feed reads to collect the authors it cares about.
followSchema.index({ followerId: 1, createdAt: -1, _id: -1 });

export type FollowModel = Model<FollowDocument>;

export function followModel(connection: Connection): FollowModel {
  return connection.model<FollowDocument>('Follow', followSchema);
}
