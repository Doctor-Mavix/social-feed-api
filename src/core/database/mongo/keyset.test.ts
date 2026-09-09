import { describe, expect, it } from 'vitest';

import {
  compositeKeysetFilter,
  compositeKeysetSort,
  compositeSortKey,
  keysetFilter,
  keysetSort,
} from './keyset';

const cursor = { value: '2026-08-21T05:25:28.724Z', id: 'b' };

describe('keysetFilter', () => {
  it('is empty on the first page', () => {
    expect(keysetFilter(null, 'desc', 'createdAt')).toEqual({});
  });

  it('compares the tuple, so rows sharing a timestamp are neither skipped nor repeated', () => {
    const at = new Date(cursor.value);

    expect(keysetFilter(cursor, 'desc', 'createdAt')).toEqual({
      $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: 'b' } }],
    });
  });

  it('walks the other way when the direction is ascending', () => {
    expect(keysetSort('asc', 'createdAt')).toEqual({ createdAt: 1, _id: 1 });
    expect(keysetSort('desc', 'createdAt')).toEqual({ createdAt: -1, _id: -1 });
  });
});

describe('compositeSortKey', () => {
  it('orders by the pair, because the timestamp half is fixed width', () => {
    const early = compositeSortKey(new Date('2026-01-01T00:00:00.000Z'), 'zzz');
    const late = compositeSortKey(new Date('2026-08-21T05:25:28.724Z'), 'aaa');

    expect(early < late).toBe(true);
  });

  it('falls back to the id when the timestamps are identical', () => {
    const at = new Date('2026-08-21T05:25:28.724Z');

    expect(compositeSortKey(at, 'a') < compositeSortKey(at, 'b')).toBe(true);
  });

  it('accepts the ISO string a cursor carries and the Date a document carries', () => {
    const at = new Date(cursor.value);

    expect(compositeSortKey(cursor.value, 'x')).toBe(compositeSortKey(at, 'x'));
  });
});

describe('compositeKeysetFilter', () => {
  it('is empty on the first page', () => {
    expect(compositeKeysetFilter(null, 'desc', 'feedKey')).toEqual({});
  });

  /**
   * The whole reason this variant exists. A page scoped by `$in` — every feed — must not carry
   * an `$or`: MongoDB will not distribute the branches across the `$in` bounds, and falls back
   * to unioning the scans and sorting the union in memory. Measured on 100k posts, that was
   * 13706 index keys examined for a 20-row page instead of 71.
   */
  it('emits a single bound, never an $or', () => {
    const filter = compositeKeysetFilter(cursor, 'desc', 'feedKey');

    expect(filter).toEqual({ feedKey: { $lt: `${cursor.value}|b` } });
    expect(Object.keys(filter)).not.toContain('$or');
  });

  it('turns around with the direction', () => {
    expect(compositeKeysetFilter(cursor, 'asc', 'feedKey')).toEqual({
      feedKey: { $gt: `${cursor.value}|b` },
    });
    expect(compositeKeysetSort('asc', 'feedKey')).toEqual({ feedKey: 1 });
    expect(compositeKeysetSort('desc', 'feedKey')).toEqual({ feedKey: -1 });
  });
});
