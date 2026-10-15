import type { QueryClient, QueryKey } from "@tanstack/react-query";

/*
 * How the apps follow background jobs (web and mobile). Every refetchInterval and every imperative
 * poll goes through this module, so the cadence is named in one place. Timers belong here: lint bans
 * setTimeout and setInterval in the api-client sources outside this file.
 */

/** Something is running and the user is watching its progress. */
export const POLL_ACTIVE_MS = 2000;
/** A long archive build. Checked less often than a progress bar: each check is a request. */
export const POLL_ARCHIVE_MS = 3000;
/** The server is down or still starting (#2310): ask whether it serves again. */
export const POLL_BACKEND_STATUS_MS = 5000;
/** Nothing is running: only notice that something started (another tab, a scheduled job). */
export const POLL_IDLE_MS = 15000;
/** Delay before invalidating after a write, so the writes that follow the response land first. */
const INVALIDATE_SETTLE_MS = 100;

type PollableQuery<TData> = { state: { data: TData | undefined } };

/**
 * A refetchInterval that polls every POLL_ACTIVE_MS while isActive(data) holds, and every idleMs
 * otherwise (false stops polling). Nothing is polled before the first answer, so a failing request
 * (a missing job, a 404) is not retried on the active cadence.
 */
export function pollWhile<TData>(isActive: (data: TData) => boolean, idleMs: number | false = POLL_IDLE_MS) {
  return (query: PollableQuery<TData>): number | false => {
    const { data } = query.state;
    return data !== undefined && isActive(data) ? POLL_ACTIVE_MS : idleMs;
  };
}

export type PollUntilOptions<TResult> = {
  /** The poll ends with the first result for which this holds. */
  isDone: (result: TResult) => boolean;
  /** Wait between checks. The first check comes after one wait, not at once. */
  intervalMs?: number;
  /** Aborting stops the poll: the promise rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Without it the poll runs until isDone holds or the signal aborts. */
  timeoutMs?: number;
};

export class PollTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Polling did not finish within ${timeoutMs} ms`);
    this.name = "PollTimeoutError";
  }
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Calls check() every intervalMs until isDone(result) holds, and resolves with that result. Errors
 * from check() reject the promise at once; nothing is retried here.
 */
export async function pollUntil<TResult>(
  check: () => Promise<TResult>,
  { isDone, intervalMs = POLL_ACTIVE_MS, signal, timeoutMs }: PollUntilOptions<TResult>
): Promise<TResult> {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  for (;;) {
    await wait(intervalMs, signal);
    const result = await check();
    if (signal?.aborted) {
      throw signal.reason;
    }
    if (isDone(result)) {
      return result;
    }
    if (deadline !== undefined && timeoutMs !== undefined && Date.now() >= deadline) {
      throw new PollTimeoutError(timeoutMs);
    }
  }
}

/**
 * Invalidates the given queries after a short delay. The delay lets the writes that follow a
 * response land before the reads are refetched.
 */
export function invalidateAfter(
  client: QueryClient,
  queryKeys: readonly QueryKey[],
  delayMs: number = INVALIDATE_SETTLE_MS
): void {
  setTimeout(() => {
    for (const queryKey of queryKeys) {
      void client.invalidateQueries({ queryKey });
    }
  }, delayMs);
}
