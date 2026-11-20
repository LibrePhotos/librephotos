export function defined<T>(value: T | null | undefined, what = "the value"): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be present, got ${String(value)}`);
  return value;
}
