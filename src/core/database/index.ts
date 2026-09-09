import type { Connection } from 'mongoose';

import { env, isProduction } from '@core/config/env';
import { MongooseAdapter } from '@core/database/mongo/mongoose.adapter';
import type { DatabaseAdapter } from '@core/database/types';
import { ConfigurationError } from '@core/errors/app-error';
import { logger } from '@core/logger/logger';

/**
 * The template ships two engines; this project keeps one. A social graph is read far more
 * often than it is written, the documents it stores are nested and irregular, and nothing here
 * needs a transaction spanning several collections. `DB_PROVIDER` is validated down to
 * `mongodb` in the environment schema, which is what makes this function a single branch.
 */
export function createDatabaseAdapter(): DatabaseAdapter {
  return new MongooseAdapter({
    url: env.DATABASE_URL,
    poolSize: env.DB_POOL_SIZE,
    connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
    slowQueryMs: env.DB_SLOW_QUERY_MS,
    logger,
    autoIndex: !isProduction,
  });
}

/**
 * Narrows an adapter to its connection. A repository asks for the client it was written
 * against; asking for the wrong one is a wiring bug and stops the boot instead of failing
 * on the first request.
 */
export function mongoConnectionOf(adapter: DatabaseAdapter): Connection {
  if (!(adapter instanceof MongooseAdapter)) {
    throw new ConfigurationError(
      `A MongoDB repository was wired while DB_PROVIDER is "${adapter.provider}"`,
    );
  }

  return adapter.connection;
}

export type { DatabaseAdapter, DbProvider } from '@core/database/types';
