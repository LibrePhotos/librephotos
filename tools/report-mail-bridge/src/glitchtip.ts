// Sending one event envelope to GlitchTip (any Sentry-compatible server).

const TIMEOUT_MS = 10_000;
const CLIENT = "librephotos-report-mail-bridge/1";

export type Dsn = { url: string; auth: string };

/** The envelope endpoint and auth header of a DSN like `https://key@host/path/project`. */
export function parseDsn(dsn: string): Dsn {
  const url = new URL(dsn);
  const parts = url.pathname.split("/").filter(Boolean);
  const project = parts.pop();
  if (!url.username || !project) throw new Error("GLITCHTIP_DSN is not a valid DSN");
  const prefix = parts.length ? `/${parts.join("/")}` : "";
  return {
    url: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`,
    auth: `Sentry sentry_version=7, sentry_client=${CLIENT}, sentry_key=${url.username}`,
  };
}

/**
 * sent: delivered. refused: GlitchTip will never take this event.
 * unavailable: try again later, which includes a wrong DSN or a missing
 * project (401, 403, 404): the mail then waits at the sender until it is fixed.
 */
export type SendResult = "sent" | "refused" | "unavailable";
export type Send = (envelope: string) => Promise<SendResult>;
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// What GlitchTip answers for an event it cannot take.
const REFUSED = new Set([400, 413, 415, 422]);

function outcome(status: number): SendResult {
  if (status >= 200 && status < 300) return "sent";
  return REFUSED.has(status) ? "refused" : "unavailable";
}

export function glitchTipSender(dsn: string, fetcher: Fetcher = fetch): Send {
  const target = parseDsn(dsn);
  return async (envelope) => {
    try {
      const response = await fetcher(target.url, {
        method: "POST",
        body: envelope,
        headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": target.auth },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await response.body?.cancel();
      return outcome(response.status);
    } catch {
      return "unavailable";
    }
  };
}
