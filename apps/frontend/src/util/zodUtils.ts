import { z, ZodError } from "zod";
import { notification } from "../service/notifications";

/** The issues of a failed parse as one line: each message with the path it is at. */
function describeIssues(error: ZodError): string {
  const errorMessages = error.issues.map(issue => {
    const path = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    return `${issue.message}${path}`;
  });
  return errorMessages.length > 0 ? errorMessages.join("; ") : error.message || "Failed to parse response";
}

/**
 * Parse data with a Zod schema and automatically show error notifications on failure.
 *
 * @param schema - The Zod schema to parse against
 * @param data - The data to parse
 * @param errorTitle - Optional title for the error notification (default: "Parse Error")
 * @returns The parsed data
 * @throws ZodError if parsing fails
 */
export function parseWithNotification<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
  errorTitle: string = "Parse Error"
): z.output<Schema> {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      // The callers' titles and the Zod text are English diagnostics for the bug
      // report: they go in the message, under a translated title.
      notification.parseError(`${errorTitle}: ${describeIssues(error)}`);
    } else {
      // Handle non-Zod errors
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      notification.parseError(`${errorTitle}: ${errorMessage}`);
    }

    throw error;
  }
}

/**
 * Parse a list entry by entry: keep the entries the schema reads, and report the others in one
 * notification instead of failing the whole list. For lists where one entry this client cannot
 * read (a rule type a newer backend added, say) must not take the rest down with it. A value
 * that is not a list at all still fails, as in {@link parseWithNotification}.
 */
export function parseListWithNotification<Item extends z.ZodType>(
  itemSchema: Item,
  data: unknown,
  errorTitle: string = "Parse Error"
): z.output<Item>[] {
  const entries = parseWithNotification(z.array(z.unknown()), data, errorTitle);
  const items: z.output<Item>[] = [];
  const skipped: string[] = [];
  entries.forEach((entry, index) => {
    const result = itemSchema.safeParse(entry);
    if (result.success) {
      items.push(result.data);
    } else {
      skipped.push(`entry ${index}: ${describeIssues(result.error)}`);
    }
  });
  if (skipped.length > 0) {
    notification.parseError(`${errorTitle}: skipped ${skipped.length} of ${entries.length} (${skipped.join(" | ")})`);
  }
  return items;
}
