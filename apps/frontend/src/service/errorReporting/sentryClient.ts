/**
 * The Sentry browser SDK, loaded by `reportBrowserError` with the first error (#2938). It builds
 * the error event (type, message, stack) and hands the envelope to this server rather than to a
 * reporting server: the transport forwards it to `/api/error-reports/browser/`, where the backend
 * scrubs it like its own errors. No breadcrumbs, sessions, tracing or replays, and no global
 * handlers of its own (`reportBrowserError` has them).
 */
import {
  captureException,
  createTransport,
  dedupeIntegration,
  functionToStringIntegration,
  init,
  linkedErrorsIntegration,
} from "@sentry/react";
import { forwardBrowserError } from "../../api_client/errorReports/forwardBrowserError";

/**
 * The SDK sends nothing without a DSN. This one names no server and is never contacted: the
 * transport below takes every envelope. The real destination is a backend setting only.
 */
const FORWARD_ONLY_DSN = "https://forwardonly@librephotos.invalid/1";

function envelopeText(body: string | Uint8Array): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

init({
  dsn: FORWARD_ONLY_DSN,
  defaultIntegrations: false,
  integrations: [functionToStringIntegration(), linkedErrorsIntegration(), dedupeIntegration()],
  // No user, cookies, headers, bodies or query strings; the backend scrubs what is left.
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
  maxBreadcrumbs: 0,
  sendClientReports: false,
  environment: "production",
  transport: options =>
    createTransport(options, async request => {
      const forwarded = await forwardBrowserError(envelopeText(request.body)).catch(() => false);
      return forwarded ? { statusCode: 200 } : {};
    }),
});

export function capture(error: unknown): void {
  captureException(error);
}
