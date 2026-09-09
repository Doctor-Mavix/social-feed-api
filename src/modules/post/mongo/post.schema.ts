import type { Connection, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { softDeletePlugin } from '@core/database/mongo/soft-delete.plugin';

export interface PostDocument {
  _id: string;
  authorId: string;
  text: string;
  imageIds: string[];
  likeCount: number;
  commentCount: number;
  /** `createdAt` and `_id` as one comparable string — see `compositeSortKey`. */
  feedKey: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const postSchema = new Schema<PostDocument>(
  {
    _id: { type: String, required: true },
    authorId: { type: String, required: true },
    text: { type: String, required: true },
    imageIds: { type: [String], default: [] },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    feedKey: { type: String, required: true },
  },
  { timestamps: true, versionKey: false, collection: 'posts' },
);

// A deleted post has to stop appearing in every feed at once, and the plugin scopes every read
// rather than trusting each query to remember.
postSchema.plugin(softDeletePlugin);

// The index the whole application turns on. The feed asks for `authorId $in [...]` sorted newest
// first: with the author first and the sort key next, MongoDB walks one range per author and
// merges them, instead of collecting every post and sorting the pile. Sorting on `feedKey`
// rather than on `(createdAt, _id)` is what keeps the merge — see `compositeSortKey`.
postSchema.index({ authorId: 1, feedKey: -1 });

export type PostModel = Model<PostDocument>;

export function postModel(connection: Connection): PostModel {
  return connection.model<PostDocument>('Post', postSchema);
}
