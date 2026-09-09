import 'reflect-metadata';

import type { DependencyContainer } from 'tsyringe';

import { env } from '@core/config/env';
import { createAppContainer } from '@core/container';
import { TOKENS } from '@core/container/tokens';
import { createDatabaseAdapter } from '@core/database';
import type { DatabaseAdapter } from '@core/database/types';
import { logger } from '@core/logger/logger';
import { registerModules } from '@core/module';
import { RedisConnection } from '@core/redis/redis.client';
import { APP_MODULES } from '@modules/index';
import { registerSharedServices } from '@shared/index';

export interface ScriptContext {
  container: DependencyContainer;
  adapter: DatabaseAdapter;
  redis: RedisConnection;
}

/**
 * The same container the server builds, without the HTTP layer. Scripts go through it rather
 * than opening their own Mongoose connection so they exercise the repositories the application
 * actually uses — a seed written against the driver can produce rows the code cannot read.
 */
export async function withApp<T>(run: (context: ScriptContext) => Promise<T>): Promise<T> {
  const adapter = createDatabaseAdapter();
  const redis = new RedisConnection({
    url: env.REDIS_URL,
    keyPrefix: env.REDIS_KEY_PREFIX,
    connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
    logger,
  });

  await adapter.connect();
  await redis.connect();

  try {
    const container = createAppContainer();

    container.registerInstance(TOKENS.DatabaseAdapter, adapter);
    container.registerInstance(TOKENS.Redis, redis);
    registerSharedServices(container);
    registerModules(APP_MODULES, { container, provider: adapter.provider, adapter });

    return await run({ container, adapter, redis });
  } finally {
    await adapter.disconnect();
    await redis.disconnect();
  }
}

export function say(message: string): void {
  process.stdout.write(`${message}\n`);
}
