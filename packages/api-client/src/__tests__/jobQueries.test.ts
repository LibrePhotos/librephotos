import { describe, expect, it, vi } from "vitest";
import {
  jobListRefetchInterval,
  jobsQueryOptions,
  queryKeys,
  workerAvailabilityQueryOptions,
  workerRefetchInterval,
} from "../hooks";
import { POLL_ACTIVE_MS, POLL_IDLE_MS } from "../polling";
import type { JobsResponse, WorkerAvailabilityResponse } from "../schemas";
import { createApiClient } from "../transport";
import type { TokenSupplier } from "../transport";

// The node project has no window, so TanStack Query starts no refetch timers here. These tests check the
// refetchInterval functions the hooks hand to React Query, for each state of the cached data; the timing
// itself (pollWhile, the observer's interval) is covered by polling.test.ts and the web's hook tests (jsdom).

const FUTURE_JWT =
  "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ exp: 9999999999, user_id: 1 })).toString("base64url") + ".sig";

const tokens: TokenSupplier = {
  getAccessToken: () => FUTURE_JWT,
  getRefreshToken: () => "r",
  setAccessToken: () => {},
  clearTokens: () => {},
};

const client = createApiClient({
  baseUrl: "https://demo.example.com",
  tokens,
  fetch: vi.fn(() => Promise.reject(new Error("no request is expected here"))),
});

/** The query state the cadence reads: none before the first answer, then the data. */
const state = <TData>(data: TData | undefined) => ({ state: { data } });

const job = (finished: boolean) => ({
  job_id: "abc",
  queued_at: "2024-01-01T00:00:00Z",
  started_at: null,
  finished_at: null,
  finished,
  failed: false,
  cancelled: false,
  job_type: 1,
  job_type_str: "Scan Photos",
  started_by: { id: 1, username: "admin", first_name: "A", last_name: "D" },
  progress_current: 0,
  progress_target: 10,
  id: 1,
});

describe("worker availability query", () => {
  const worker = (queue_can_accept_job: boolean): WorkerAvailabilityResponse => ({
    status: true,
    queue_can_accept_job,
  });

  it("polls at the active cadence while the worker is busy and at the idle cadence while it is free", () => {
    expect(workerRefetchInterval(state(worker(false)))).toBe(POLL_ACTIVE_MS);
    expect(workerRefetchInterval(state(worker(true)))).toBe(POLL_IDLE_MS);
  });

  it("does not poll at the active cadence before the first answer", () => {
    expect(workerRefetchInterval(state(undefined))).toBe(POLL_IDLE_MS);
  });

  it("is disabled, so it sends no request, when asked to be", () => {
    expect(workerAvailabilityQueryOptions(client, { enabled: false }).enabled).toBe(false);
    expect(workerAvailabilityQueryOptions(client).enabled).toBe(true);
  });
});

describe("job list query", () => {
  const page = (...finished: boolean[]): JobsResponse => ({
    count: finished.length,
    next: null,
    previous: null,
    results: finished.map(done => job(done)),
  });

  it("polls at the active cadence only while a job on the page is unfinished", () => {
    expect(jobListRefetchInterval(state(page(true, false)))).toBe(POLL_ACTIVE_MS);
    expect(jobListRefetchInterval(state(page(true, true)))).toBe(POLL_IDLE_MS);
    expect(jobListRefetchInterval(state(page()))).toBe(POLL_IDLE_MS);
  });

  it("does not poll at the active cadence before the first answer", () => {
    expect(jobListRefetchInterval(state(undefined))).toBe(POLL_IDLE_MS);
  });

  it("is disabled, so it sends no request, when asked to be", () => {
    expect(jobsQueryOptions(client, { enabled: false }).enabled).toBe(false);
  });

  // The page and page size were sent with the request but left out of the key, so two pages would
  // have shared one cache entry.
  it("keys each page and page size apart, under the jobs prefix", () => {
    const first = jobsQueryOptions(client, { page: 1, pageSize: 20 }).queryKey;
    expect(first).toEqual(jobsQueryOptions(client).queryKey);
    expect(jobsQueryOptions(client, { page: 2, pageSize: 20 }).queryKey).not.toEqual(first);
    expect(jobsQueryOptions(client, { page: 1, pageSize: 50 }).queryKey).not.toEqual(first);
    expect(first.slice(0, queryKeys.jobs().length)).toEqual(queryKeys.jobs());
  });
});
