/**
 * Runtime checks for data whose shape the compiler cannot vouch for: a JSON
 * blob read back from SQLite, a server response body, a JWT payload. Narrow
 * with these (or parse with a zod schema) instead of asserting a type.
 */

/** A non-null, non-array object, whose fields can then be read as `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An array, typed as `unknown[]`: `Array.isArray` alone would narrow to an array of `any`. */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Parse JSON without letting `any` out: the result is `unknown` until checked. */
export function parseJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}
