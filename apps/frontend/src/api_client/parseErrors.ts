import { ResponseParseError, type ParsedEntries } from "@librephotos/api-client";
import { notification } from "../service/notifications";

/**
 * A response that did not match its schema (server drift) asks the user to report it. The
 * QueryClient's error handlers (api.ts) call it for every failed query and mutation.
 */
export function notifyParseError(error: unknown): void {
  if (error instanceof ResponseParseError) {
    notification.parseError(`${error.context}: ${error.issues}`);
  }
}

/** The usable entries of a list parsed entry by entry; the ones this client could not read go in one toast. */
export function keepParsedEntries<T>(title: string, list: ParsedEntries<T>): T[] {
  if (list.skipped.length > 0) {
    notification.parseError(`${title}: skipped ${list.skipped.length} of ${list.total} (${list.skipped.join(" | ")})`);
  }
  return list.items;
}
