import type { Query, Schema } from 'mongoose';

/** Everything that reads or updates documents and must ignore deleted ones. */
const SCOPED_OPERATIONS =
  /^(find|findOne|findOneAnd|count|countDocuments|distinct|update|updateOne|updateMany|replaceOne)/;

/** Set on a query to deliberately include deleted documents (restore flows, admin exports). */
export const WITH_DELETED = 'withDeleted';

type AnyQuery = Query<unknown, unknown>;

/**
 * Mongo counterpart of the Prisma soft-delete extension: adds `deletedAt` to the schema and
 * scopes every read to live documents. Deletion itself is a repository concern — it writes
 * the timestamp — so a genuine hard delete stays possible without fighting the plugin.
 */
export function softDeletePlugin(schema: Schema): void {
  schema.add({ deletedAt: { type: Date, default: null } });
  schema.index({ deletedAt: 1 });

  schema.pre(SCOPED_OPERATIONS, function (this: AnyQuery) {
    const options: Record<string, unknown> = this.getOptions();

    if (options[WITH_DELETED] !== true && !('deletedAt' in this.getFilter())) {
      void this.where({ deletedAt: null });
    }
  });
}
