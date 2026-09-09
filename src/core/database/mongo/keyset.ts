import type { SortOrder } from 'mongoose';

import type { CursorQuery, SortDirection } from '@core/database/pagination';

/**
 * The `$or` a keyset page needs, because MongoDB has no tuple comparison: "sorted past the
 * cursor's value, or on that exact value but past its id". Without the second branch, rows
 * sharing a timestamp are either skipped or served twice.
 */
export function keysetFilter(
  cursor: CursorQuery['cursor'],
  direction: SortDirection,
  field: string,
  value: (raw: string) => unknown = (raw) => new Date(raw),
): Record<string, unknown> {
  if (cursor === null) {
    return {};
  }

  const beyond = direction === 'asc' ? '$gt' : '$lt';
  const at = value(cursor.value);

  return {
    $or: [{ [field]: { [beyond]: at } }, { [field]: at, _id: { [beyond]: cursor.id } }],
  };
}

/** The sort that matches `keysetFilter`. Using one without the other produces silent gaps. */
export function keysetSort(direction: SortDirection, field: string): Record<string, SortOrder> {
  const order: SortOrder = direction === 'asc' ? 1 : -1;

  return { [field]: order, _id: order };
}

/**
 * The pair `(sortValue, id)` flattened into one lexicographically comparable string, to be
 * stored on the document and indexed.
 *
 * `keysetFilter` is correct but it does not survive being combined with an `$in`: the planner
 * cannot distribute the two `$or` branches across the `$in` bounds, so it unions the scans and
 * sorts the union in memory. Measured on a 100k-post feed, a 20-row page at depth 12000 went
 * from 71 keys examined to 13706. Collapsing the tuple into a single key turns the page back
 * into one range bound, which the planner does push into every branch of the `$in`.
 *
 * The timestamp half must be fixed width for the string order to be the pair order, which an
 * ISO-8601 UTC timestamp is.
 */
export function compositeSortKey(value: Date | string, id: string): string {
  return `${typeof value === 'string' ? value : value.toISOString()}|${id}`;
}

/** `keysetFilter` for a field written with `compositeSortKey`: one bound, no `$or`. */
export function compositeKeysetFilter(
  cursor: CursorQuery['cursor'],
  direction: SortDirection,
  field: string,
): Record<string, unknown> {
  if (cursor === null) {
    return {};
  }

  return {
    [field]: { [direction === 'asc' ? '$gt' : '$lt']: compositeSortKey(cursor.value, cursor.id) },
  };
}

/** The matching sort. The tie-break lives inside the key, so `_id` is not needed here. */
export function compositeKeysetSort(
  direction: SortDirection,
  field: string,
): Record<string, SortOrder> {
  return { [field]: direction === 'asc' ? 1 : -1 };
}
