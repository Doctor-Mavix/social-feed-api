import type { Connection, Model } from 'mongoose';
import { Schema } from 'mongoose';

export interface LikeDocument {
  _id: string;
  postId: string;
  actorId: string;
  createdAt: Date;
}

const likeSchema = new Schema<LikeDocument>(
  {
    _id: { type: String, required: true },
    postId: { type: String, required: true },
    actorId: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'likes',
  },
);

// The edge, and the reason the Redis counter can be rebuilt: one row per person per post.
// Unique, so a double tap counts once even if both requests arrive at the same moment.
likeSchema.index({ postId: 1, actorId: 1 }, { unique: true });
// "Which of these posts have I liked" for a whole feed page, in one query.
likeSchema.index({ actorId: 1, postId: 1 });

export type LikeModel = Model<LikeDocument>;

export function likeModel(connection: Connection): LikeModel {
  return connection.model<LikeDocument>('Like', likeSchema);
}
