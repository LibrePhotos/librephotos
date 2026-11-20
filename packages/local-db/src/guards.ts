/** Runtime checks for JSON read back from SQLite: narrow instead of asserting a type. */

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Parse JSON without letting `any` out: the result is `unknown` until checked. */
export function parseJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}
