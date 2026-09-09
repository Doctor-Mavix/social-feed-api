/** A patch with the keys that were never set removed, rather than set to `undefined`. */
export type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Drops the keys whose value is `undefined`.
 *
 * `exactOptionalPropertyTypes` makes a missing key and an explicit `undefined` two different
 * types, and a Zod `.partial()` body produces the second: every key is present, most of them
 * holding `undefined`. Handing that straight to a repository whose patch type is written
 * `handle?: string` does not compile. The two ways around it are turning the compiler flag off
 * for the whole project, or removing the keys; this removes the keys.
 *
 * It is also the behaviour a PATCH endpoint should have anyway: a field the client did not
 * mention must not reach the database at all — not even to be compared against `undefined`.
 */
export function definedOnly<T extends object>(patch: T): Defined<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Defined<T>;
}
