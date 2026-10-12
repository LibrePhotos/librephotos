import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { jobsQueryOptions, workerAvailabilityQueryOptions } from "../hooks";
import type { JobsResponse, WorkerAvailabilityResponse } from "../schemas";
import { POLL_ACTIVE_MS, POLL_IDLE_MS } from "../polling";
import { createApiClient } from "../transport";
import type { TokenSupplier } from "../transport";

// The node project has no window, so TanStack Query starts no refetch timers here. These tests check the
// refetchInterval the hooks hand to React Query for each state of the cached data; the timing itself
// (pollWhile, the observer's interval) is covered by polling.test.ts and the web's hook tests (jsdom).

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

/** The interval React Query polls at for a jobs query holding `data` (none before the first answer). */
function jobsInterval(data?: JobsResponse): number | false {
  const options = jobsQueryOptions(client, { pageSize: 20 });
  const queryClient = new QueryClient();
  const query = queryClient.getQueryCache().build(queryClient, options);
  if (data !== undefined) query.setData(data);
  const { refetchInterval } = options;
  return typeof refetchInterval === "function" ? (refetchInterval(query) ?? false) : (refetchInterval ?? false);
}

/** The interval React Query polls at for a worker query holding `data` (none before the first answer). */
function workerInterval(data?: WorkerAvailabilityResponse): number | false {
  const options = workerAvailabilityQueryOptions(client);
  const queryClient = new QueryClient();
  const query = queryClient.getQueryCache().build(queryClient, options);
  if (data !== undefined) query.setData(data);
  const { refetchInterval } = options;
  return typeof refetchInterval === "function" ? (refetchInterval(query) ?? false) : (refetchInterval ?? false);
}

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
  const worker = (queue_can_accept_job: boolean): WorkerAvailabilityResponse => ({ status: true, queue_can_accept_job });

  it("polls at the active cadence while the worker is busy and at the idle cadence while it is free", () => {
    expect(workerInterval(worker(false))).toBe(POLL_ACTIVE_MS);
    expect(workerInterval(worker(true))).toBe(POLL_IDLE_MS);
  });

  it("does not poll at the active cadence before the first answer", () => {
    expect(workerInterval(undefined)).toBe(POLL_IDLE_MS);
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
    expect(jobsInterval(page(true, false))).toBe(POLL_ACTIVE_MS);
    expect(jobsInterval(page(true, true))).toBe(POLL_IDLE_MS);
    expect(jobsInterval(page())).toBe(POLL_IDLE_MS);
  });

  it("does not poll at the active cadence before the first answer", () => {
    expect(jobsInterval(undefined)).toBe(POLL_IDLE_MS);
  });

  it("is disabled, so it sends no request, when asked to be", () => {
    expect(jobsQueryOptions(client, { enabled: false }).enabled).toBe(false);
  });
});
