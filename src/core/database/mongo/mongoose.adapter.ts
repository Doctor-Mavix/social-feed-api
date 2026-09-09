import type { Connection } from 'mongoose';
import mongoose from 'mongoose';

import { queryTimingPlugin } from '@core/database/mongo/query-timing.plugin';
import type { DatabaseAdapter, DbProvider } from '@core/database/types';
import type { Logger } from '@core/logger/logger';

export interface MongooseAdapterOptions {
  url: string;
  poolSize: number;
  connectTimeoutMs: number;
  slowQueryMs: number;
  /** Index creation is a migration concern in production; leave it to `pnpm db:*` there. */
  autoIndex: boolean;
  logger: Logger;
}

export class MongooseAdapter implements DatabaseAdapter {
  readonly provider: DbProvider = 'mongodb';
  readonly connection: Connection;

  constructor(options: MongooseAdapterOptions) {
    // createConnection instead of the global mongoose.connect: the connection is an
    // explicit object we can inject, close and swap in tests, with no module-level state.
    this.connection = mongoose.createConnection(options.url, {
      maxPoolSize: options.poolSize,
      serverSelectionTimeoutMS: options.connectTimeoutMs,
      connectTimeoutMS: options.connectTimeoutMs,
      autoIndex: options.autoIndex,
    });

    this.connection.plugin(queryTimingPlugin, {
      logger: options.logger,
      thresholdMs: options.slowQueryMs,
    });
  }

  async connect(): Promise<void> {
    await this.connection.asPromise();
  }

  async disconnect(): Promise<void> {
    await this.connection.close();
  }

  async ping(): Promise<void> {
    const { db } = this.connection;

    if (db === undefined) {
      throw new Error('MongoDB connection is not established');
    }

    await db.admin().command({ ping: 1 });
  }
}
