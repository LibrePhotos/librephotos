import type { z } from "zod";
import { ZodError } from "zod";
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
