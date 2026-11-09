/**
 * The web app's side of error reporting (#2938), the part in the main bundle: listeners for
 * uncaught errors and rejected promises, and `reportBrowserError` for the error boundaries. The
 * Sentry SDK (`sentryClient.ts`) is loaded only when the first error comes, so a session without
 * one never downloads it. Every error goes to this server, which scrubs and saves it and sends it
 * on only when an admin chose a server; the web app never talks to a reporting server itself.
 */

/** A page stuck in an error loop sends this many and then stops. */
const MAX_REPORTS_PER_PAGE = 10;

/** Messages that are browser noise rather than errors in LibrePhotos. */
const NOISE = [/ResizeObserver loop/, /^Script error\.?$/];

type SentryClient = typeof import("./sentryClient");

let reported = 0;
let client: Promise<SentryClient> | undefined;

function loadClient(): Promise<SentryClient> {
  client ??= import("./sentryClient");
  return client;
}

/** Report one error; it is dropped silently when it cannot be forwarded. */
export function reportBrowserError(error: unknown): void {
  if (reported >= MAX_REPORTS_PER_PAGE) {
    return;
  }
  reported += 1;
  void loadClient()
    .then(sentry => sentry.capture(error))
    .catch(() => undefined);
}

function isNoise(event: ErrorEvent): boolean {
  // Errors of browser extensions run in the page too.
  if (/^(chrome|moz|safari(-web)?)-extension:/.test(event.filename)) {
    return true;
  }
  return NOISE.some(pattern => pattern.test(event.message));
}

function onError(event: ErrorEvent): void {
  if (!isNoise(event)) {
    reportBrowserError(event.error ?? event.message);
  }
}

function onRejection(event: PromiseRejectionEvent): void {
  reportBrowserError(event.reason);
}

/** Listen for the page's uncaught errors; called once, before the app renders. Returns the undo. */
export function installErrorReporting(): () => void {
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
