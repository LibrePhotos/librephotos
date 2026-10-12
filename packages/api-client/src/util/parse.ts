import type { z } from "zod";

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
export function parseResponse<T>(schema: z.ZodType<T>, data: unknown, context = "response"): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ResponseParseError(context, describeIssues(result.error));
  }
  return result.data;
}

/** `path: message` per zod issue, joined with "; ". */
function describeIssues(error: z.ZodError): string {
  return error.issues.map(issue => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`).join("; ");
}

/** A list parsed entry by entry: the entries the schema reads, and why the others were skipped. */
export type ParsedEntries<T> = {
  items: T[];
  /** `entry <index>: <issues>` for each entry the schema rejected. */
  skipped: string[];
  /** How many entries the response had. */
  total: number;
};

/**
 * Parse a list response entry by entry: keep the entries the schema reads and say why the others
 * were skipped, instead of failing the whole list. For lists where one entry this client cannot
 * read (a rule type a newer backend added, say) must not take the rest down with it; the app
 * reports `skipped`. A response that is not a list at all still throws a ResponseParseError.
 */
export function parseEachResponse<T>(itemSchema: z.ZodType<T>, data: unknown, context = "response"): ParsedEntries<T> {
  if (!Array.isArray(data)) {
    throw new ResponseParseError(context, `(root): expected an array, got ${data === null ? "null" : typeof data}`);
  }
  const entries: unknown[] = data;
  const items: T[] = [];
  const skipped: string[] = [];
  entries.forEach((entry, index) => {
    const result = itemSchema.safeParse(entry);
    if (result.success) {
      items.push(result.data);
    } else {
      skipped.push(`entry ${index}: ${describeIssues(result.error)}`);
    }
  });
  return { items, skipped, total: entries.length };
}

/** Build a `?a=b&c=d` query string, dropping undefined/null values. */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  const qs = new URLSearchParams(entries).toString();
  return qs ? `?${qs}` : "";
}
