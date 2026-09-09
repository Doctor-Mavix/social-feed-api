import type { Connection, QueryFilter } from 'mongoose';

import type { CursorPage, CursorQuery } from '@core/database/pagination';
import { buildCursorPage } from '@core/database/pagination';
import type { NewNotification, NotificationRepository } from '../notification.repository';
import type { Notification } from '../notification.types';
import { notificationModel } from './notification.schema';
import type { NotificationDocument, NotificationModel } from './notification.schema';

function toNotification(document: NotificationDocument): Notification {
  return {
    id: document._id,
    actorId: document.actorId,
    type: document.type,
    title: document.title,
    body: document.body,
    data: document.data,
    readAt: document.readAt,
    createdAt: document.createdAt,
  };
}

function cursorFilter(query: CursorQuery): QueryFilter<NotificationDocument> {
  if (query.cursor === null) {
    return {};
  }

  const createdAt = new Date(query.cursor.value);
  const ascending = query.direction === 'asc';

  return {
    $or: [
      { createdAt: ascending ? { $gt: createdAt } : { $lt: createdAt } },
      { createdAt, _id: ascending ? { $gt: query.cursor.id } : { $lt: query.cursor.id } },
    ],
  };
}

export class MongoNotificationRepository implements NotificationRepository {
  private readonly model: NotificationModel;

  constructor(connection: Connection) {
    this.model = notificationModel(connection);
  }

  async create(data: NewNotification): Promise<Notification> {
    const created = await this.model.create({ ...data, _id: data.id });

    return toNotification(created.toObject());
  }

  async listForActor(
    actorId: string,
    query: CursorQuery,
    unreadOnly: boolean,
  ): Promise<CursorPage<Notification>> {
    const direction = query.direction === 'asc' ? 1 : -1;
    const documents = await this.model
      .find({ actorId, ...(unreadOnly ? { readAt: null } : {}), ...cursorFilter(query) })
      .sort({ createdAt: direction, _id: direction })
      .limit(query.limit + 1)
      .lean<NotificationDocument[]>();

    return buildCursorPage(documents.map(toNotification), query.limit, (item) => ({
      value: item.createdAt.toISOString(),
      id: item.id,
    }));
  }

  async countUnread(actorId: string): Promise<number> {
    return this.model.countDocuments({ actorId, readAt: null });
  }

  async markRead(actorId: string, id: string): Promise<boolean> {
    // Scoped by actor: an id guessed from another account matches nothing rather than
    // answering a 404 that would confirm the row exists.
    const result = await this.model.updateOne(
      { _id: id, actorId, readAt: null },
      { $set: { readAt: new Date() } },
    );

    return result.modifiedCount > 0;
  }

  async markAllRead(actorId: string): Promise<number> {
    const result = await this.model.updateMany(
      { actorId, readAt: null },
      { $set: { readAt: new Date() } },
    );

    return result.modifiedCount;
  }
}
