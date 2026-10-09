/**
 * The value, or a thrown error naming what is missing. A test says "this is here" with it, and
 * fails on the spot when it is not, where a non-null assertion (`!`) only claims it is.
 */
export function defined<T>(value: T | null | undefined, what = "the value"): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be present, got ${String(value)}`);
  return value;
}
