import type { z } from "zod";

/**
 * Parse a raw API response against a zod schema. On failure we throw a
 * descriptive error rather than returning `undefined` — the contract tests and
 * the app's error boundary both want a loud failure so server drift is caught.
 * The web app can wrap this with its own notification layer if desired.
 */
export function parseResponse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  context = "response"
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Failed to parse ${context}: ${issues}`);
  }
  return result.data;
}

/** Build a `?a=b&c=d` query string, dropping undefined/null values. */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  const qs = new URLSearchParams(entries).toString();
  return qs ? `?${qs}` : "";
}
