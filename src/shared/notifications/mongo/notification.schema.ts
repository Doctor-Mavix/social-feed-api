import type { Connection, Model } from 'mongoose';
import { Schema } from 'mongoose';

import type { NotificationData } from '../notification.types';

export interface NotificationDocument {
  _id: string;
  actorId: string;
  type: string;
  title: string;
  body: string;
  data: NotificationData;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDocument>(
  {
    _id: { type: String, required: true },
    actorId: { type: String, required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'notifications' },
);

// Mirrors the SQL indexes: the inbox is read per actor, newest first.
notificationSchema.index({ actorId: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ actorId: 1, readAt: 1 });

export type NotificationModel = Model<NotificationDocument>;

export function notificationModel(connection: Connection): NotificationModel {
  return connection.model<NotificationDocument>('Notification', notificationSchema);
}
