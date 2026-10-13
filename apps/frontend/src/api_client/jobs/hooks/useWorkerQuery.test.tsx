/**
 * An idle tab must not ask for the worker status every two seconds: it checks at the idle
 * cadence and only speeds up while a job is running.
 */
import { jobKeys, POLL_ACTIVE_MS, POLL_IDLE_MS } from "@librephotos/api-client";
import type { WorkerAvailabilityResponse } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkerQuery } from "./useWorkerQuery";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
}));

vi.mock("../../api", () => ({
  apiClient: { get: stubs.get },
}));

const IDLE: WorkerAvailabilityResponse = { status: true, queue_can_accept_job: true, job_detail: null };
const BUSY: WorkerAvailabilityResponse = { status: true, queue_can_accept_job: false, job_detail: null };

let root: Root | undefined;
let queryClient: QueryClient;

function Harness() {
  useWorkerQuery();
  return null;
}

/** The answer the query holds. Read from the cache: a re-render of the harness is not needed for it. */
function cachedWorker() {
  return queryClient.getQueryData<WorkerAvailabilityResponse>(jobKeys.worker());
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  stubs.get.mockResolvedValue(IDLE);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    );
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  queryClient.clear();
  vi.useRealTimers();
});

describe("useWorkerQuery", () => {
  it("checks an idle worker at the idle interval, not every two seconds", async () => {
    expect(stubs.get).toHaveBeenCalledTimes(1);

    await advance(POLL_ACTIVE_MS * 3);
    expect(stubs.get).toHaveBeenCalledTimes(1);

    await advance(POLL_IDLE_MS - POLL_ACTIVE_MS * 3);
    expect(stubs.get).toHaveBeenCalledTimes(2);
    expect(stubs.get).toHaveBeenCalledWith("/rqavailable/");
  });

  it("switches to the active interval while a job runs, and back to idle when it ends", async () => {
    stubs.get.mockResolvedValue(BUSY);
    await advance(POLL_IDLE_MS);
    expect(stubs.get).toHaveBeenCalledTimes(2);
    expect(cachedWorker()?.queue_can_accept_job).toBe(false);

    await advance(POLL_ACTIVE_MS);
    expect(stubs.get).toHaveBeenCalledTimes(3);
    await advance(POLL_ACTIVE_MS);
    expect(stubs.get).toHaveBeenCalledTimes(4);

    stubs.get.mockResolvedValue(IDLE);
    await advance(POLL_ACTIVE_MS);
    expect(stubs.get).toHaveBeenCalledTimes(5);
    expect(cachedWorker()?.queue_can_accept_job).toBe(true);

    await advance(POLL_ACTIVE_MS * 2);
    expect(stubs.get).toHaveBeenCalledTimes(5);
  });
});
