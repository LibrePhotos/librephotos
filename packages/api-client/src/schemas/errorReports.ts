import { z } from "zod";
import { IntegerId } from "./common";

/**
 * One saved error report (#2938), as `GET /error-reports/` lists it (admins only). The event
 * itself, exactly as it would be sent, comes from `GET /error-reports/<id>/download/`.
 */
export const ErrorReport = z.object({
  id: IntegerId,
  // "server" (the backend) or "browser" (the web app); a string, so a source a newer server adds
  // does not fail the list.
  source: z.string(),
  title: z.string(),
  level: z.string(),
  release: z.string(),
  // How often it happened; the same error again within a day counts here.
  occurrences: z.number(),
  first_seen: z.string(),
  last_seen: z.string(),
  // When it was sent; null while it is only saved on the server.
  sent_at: z.string().nullable(),
});
export type ErrorReport = z.infer<typeof ErrorReport>;

/** `POST /error-reports/send/` (Send all): how many reports went, and how many the server refused. */
export const ErrorReportSendAll = z.object({
  sent: z.number(),
  failed: z.number(),
});
export type ErrorReportSendAll = z.infer<typeof ErrorReportSendAll>;

/** `POST /error-reports/browser/`: how many of the forwarded envelope's errors were saved. */
export const BrowserErrorReport = z.object({
  saved: z.number(),
});
export type BrowserErrorReport = z.infer<typeof BrowserErrorReport>;
