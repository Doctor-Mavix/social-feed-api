/** MongoDB's unique-index violation. The driver reports it as a plain numeric `code`. */
const DUPLICATE_KEY = 11_000;

/**
 * Letting the unique index reject the second writer is the only race-free way to enforce
 * uniqueness: a `findOne` followed by an `insert` leaves a window between the two in which
 * another connection inserts the same key.
 */
export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY
  );
}
