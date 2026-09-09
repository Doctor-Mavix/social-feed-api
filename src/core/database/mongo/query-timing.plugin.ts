import type { Query, Schema } from 'mongoose';

import type { Logger } from '@core/logger/logger';

const TIMED_OPERATIONS =
  /^(find|findOne|findOneAnd|count|countDocuments|estimatedDocumentCount|distinct|update|updateOne|updateMany|replaceOne|delete|deleteOne|deleteMany)/;

export interface QueryTimingOptions {
  logger: Logger;
  thresholdMs: number;
}

/** `op` is set by Mongoose on every query but is missing from its public typings. */
type TimedQuery = Query<unknown, unknown> & { __startedAt?: number; op?: string };

/** Mongo counterpart of the Prisma slow-query extension, so both providers report the same way. */
export function queryTimingPlugin(schema: Schema, options: QueryTimingOptions): void {
  schema.pre(TIMED_OPERATIONS, function (this: TimedQuery) {
    this.__startedAt = performance.now();
  });

  schema.post(TIMED_OPERATIONS, function (this: TimedQuery) {
    const startedAt = this.__startedAt;

    if (startedAt === undefined) {
      return;
    }

    const durationMs = Math.round(performance.now() - startedAt);

    if (durationMs >= options.thresholdMs) {
      options.logger.warn(
        { model: this.model.modelName, operation: this.op, durationMs },
        'slow database operation',
      );
    }
  });
}
