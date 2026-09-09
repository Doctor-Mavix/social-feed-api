import type { Connection, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { softDeletePlugin } from '@core/database/mongo/soft-delete.plugin';

export interface CommentDocument {
  _id: string;
  postId: string;
  authorId: string;
  text: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<CommentDocument>(
  {
    _id: { type: String, required: true },
    postId: { type: String, required: true },
    authorId: { type: String, required: true },
    text: { type: String, required: true },
  },
  { timestamps: true, versionKey: false, collection: 'comments' },
);

commentSchema.plugin(softDeletePlugin);

// A thread is read oldest first — a conversation only makes sense in the order it happened —
// so the keyset runs ascending, and the index covers both directions of the same range.
commentSchema.index({ postId: 1, createdAt: 1, _id: 1 });
// "How many comments did this account leave", and the cleanup when a profile goes away.
commentSchema.index({ authorId: 1, createdAt: -1 });

export type CommentModel = Model<CommentDocument>;

export function commentModel(connection: Connection): CommentModel {
  return connection.model<CommentDocument>('Comment', commentSchema);
}
