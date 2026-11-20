export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function parseJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}
