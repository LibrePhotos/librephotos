/**
 * What parseResponse needs of a schema. Typed by shape, not as a zod class: the
 * package is compiled against zod 3 (mobile) and zod 4 (web), and both versions'
 * schemas have this safeParse, which hands back the parsed value with its type.
 */
type SafeParser<T> = {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } };
};

/**
 * A response that does not match its schema, i.e. server drift. A class of its
 * own so an app can surface it in one place (the web shows a "please report
 * this" notification from its QueryClient's error handlers).
 */
export class ResponseParseError extends Error {
  /** What was being parsed, e.g. "thing albums". */
  readonly context: string;
  /** `path: message` per zod issue, joined with "; ". */
  readonly issues: string;

  constructor(context: string, issues: string) {
    super(`Failed to parse ${context}: ${issues}`);
    this.name = "ResponseParseError";
    this.context = context;
    this.issues = issues;
  }
}

/**
 * Parse a raw API response against a zod schema. On failure we throw a
 * descriptive ResponseParseError rather than returning `undefined`: the
 * contract tests and the app's error boundary both want a loud failure so
 * server drift is caught.
 */
export function parseResponse<T>(schema: SafeParser<T>, data: unknown, context = "response"): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ResponseParseError(context, issues);
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
