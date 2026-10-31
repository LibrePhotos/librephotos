/**
 * #2741: the Processing status card follows a running stage, refreshes when the job queue turns
 * busy or idle, and Run now refreshes it so the stage shows its job.
 */
import { jobKeys, POLL_ACTIVE_MS, POLL_IDLE_MS } from "@librephotos/api-client";
import type { ProcessingStatus } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useProcessingStatusQuery,
  useRetryUnmatchedFacesMutation,
  useRunProcessingStageMutation,
} from "./useProcessingStatus";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  post: vi.fn<(endpoint: string, body: unknown) => Promise<unknown>>(),
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get, post: stubs.post } }));

const RUNNING = { job_id: "j1", progress_current: 1, progress_target: 4 };

function status(running: boolean): ProcessingStatus {
  return {
    photo_count: 4,
    stages: [{ key: "things", remaining: 3, unmatched: 0, running_job: running ? RUNNING : null, last_run: null }],
  };
}

let root: Root | undefined;
let queryClient: QueryClient;
let data: ProcessingStatus | undefined;
let run: ((stage: "places") => Promise<unknown>) | undefined;
let retry: (() => Promise<unknown>) | undefined;

function Harness({ busy }: { busy: boolean }) {
  data = useProcessingStatusQuery(busy).data;
  run = useRunProcessingStageMutation().mutateAsync;
  retry = useRetryUnmatchedFacesMutation().mutateAsync;
  return null;
}

async function render(busy: boolean) {
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Harness busy={busy} />
      </QueryClientProvider>
    );
  });
  // React Query hands results to React on a timer.
  await advance(0);
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  data = undefined;
  root = createRoot(document.createElement("div"));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stubs.get.mockResolvedValue(status(false));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  queryClient.clear();
  vi.useRealTimers();
});

describe("useProcessingStatusQuery", () => {
  it("reads the status once and asks no more while nothing runs", async () => {
    await render(false);
    await advance(POLL_IDLE_MS * 2);

    expect(stubs.get).toHaveBeenCalledTimes(1);
    expect(stubs.get).toHaveBeenCalledWith("/library/processing-status/");
    expect(data?.stages[0]?.remaining).toBe(3);
  });

  it("follows a running stage until its job is done", async () => {
    stubs.get.mockResolvedValue(status(true));
    await render(false);
    await advance(POLL_ACTIVE_MS);
    expect(stubs.get).toHaveBeenCalledTimes(2);

    stubs.get.mockResolvedValue(status(false));
    await advance(POLL_ACTIVE_MS);
    await advance(POLL_IDLE_MS * 2);
    expect(stubs.get).toHaveBeenCalledTimes(3);
  });

  it("reads it again when the job queue turns busy or idle, not on the first render", async () => {
    await render(false);
    expect(stubs.get).toHaveBeenCalledTimes(1);

    await render(true);
    expect(stubs.get).toHaveBeenCalledTimes(2);
    await render(true);
    expect(stubs.get).toHaveBeenCalledTimes(2);
    await render(false);
    expect(stubs.get).toHaveBeenCalledTimes(3);
  });
});

describe("useRunProcessingStageMutation", () => {
  it("starts the stage and refreshes the status", async () => {
    await render(false);
    stubs.post.mockResolvedValue({ status: true, job_id: "j2", job_ids: ["j2"] });

    await act(async () => {
      await run?.("places");
    });
    await advance(0);

    expect(stubs.post).toHaveBeenCalledWith("/library/processing-status/run/", { stage: "places" });
    expect(stubs.get).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(jobKeys.processingStatus())?.isInvalidated).toBe(false);
  });
});

describe("useRetryUnmatchedFacesMutation", () => {
  it("tries the unmatched faces again and refreshes the status (#2888)", async () => {
    await render(false);
    stubs.post.mockResolvedValue({ status: true, job_id: "j3", job_ids: ["j3"] });

    await act(async () => {
      await retry?.();
    });
    await advance(0);

    expect(stubs.post).toHaveBeenCalledWith("/library/processing-status/retry-unmatched-faces/", {});
    expect(stubs.get).toHaveBeenCalledTimes(2);
  });
});
