import { mongoConnectionOf } from '@core/database';
import { say, withApp } from './bootstrap';

/**
 * Creates every index declared on a schema, and drops the ones that are no longer declared.
 *
 * MongoDB has no migration step — collections appear on first write — but indexes are not free
 * and are not automatic. Mongoose can build them at model creation (`autoIndex`), which is fine
 * on a laptop and wrong on a fleet: every replica would race to build the same index at boot,
 * against a collection that is serving traffic. This runs once, deliberately, before the new
 * version is released.
 *
 *   pnpm db:indexes
 */
await withApp(async ({ adapter }) => {
  const connection = mongoConnectionOf(adapter);

  // Registering the modules is what defines the models, so the loop below sees all of them.
  for (const name of connection.modelNames()) {
    const model = connection.model(name);
    const dropped = await model.syncIndexes();

    say(
      dropped.length === 0
        ? `${name}: up to date`
        : `${name}: dropped ${String(dropped.length)} stale index(es) — ${dropped.join(', ')}`,
    );
  }

  say('indexes synchronised');
});
