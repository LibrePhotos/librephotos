/**
 * #2322: the Finish the upgrade card and the account menu's count read the same tasks. Only an
 * admin asks for them, Not now takes a task off both at once, and the list follows a running task.
 */
import { jobKeys, POLL_ACTIVE_MS, POLL_IDLE_MS } from "@librephotos/api-client";
import type { UpgradeTask, UpgradeTaskList } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useDismissUpgradeTaskMutation, useOpenUpgradeTaskCount } from "./useUpgradeTasks";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  post: vi.fn<(endpoint: string, body: unknown) => Promise<unknown>>(),
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get, post: stubs.post } }));

function task(overrides: Partial<UpgradeTask>): UpgradeTask {
  return {
    key: "strip_thumbnail_metadata",
    kind: "automatic",
    optional: false,
    status: "pending",
    count: null,
    progress_current: null,
    progress_target: null,
    latest_job_id: null,
    error: null,
    completed_at: null,
    ...overrides,
  };
}

const PROBE = task({ key: "probe_videos", kind: "action", optional: true });
const DONE = task({ key: "semantic_search_conversion", status: "done" });

let root: Root | undefined;
let queryClient: QueryClient;
let count = -1;
let dismiss: ((key: string) => Promise<UpgradeTaskList>) | undefined;

function Harness({ isAdmin }: { isAdmin: boolean }) {
  count = useOpenUpgradeTaskCount(isAdmin);
  dismiss = useDismissUpgradeTaskMutation().mutateAsync;
  return null;
}

async function render(isAdmin: boolean) {
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Harness isAdmin={isAdmin} />
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
  count = -1;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stubs.get.mockResolvedValue({ tasks: [task({}), PROBE, DONE] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  queryClient.clear();
  vi.useRealTimers();
});

describe("useUpgradeTasks", () => {
  it("counts the tasks left for an admin, done ones not", async () => {
    await render(true);
    expect(stubs.get).toHaveBeenCalledWith("/upgrade-tasks/");
    expect(count).toBe(2);
  });

  it("asks nothing for anyone else", async () => {
    await render(false);
    expect(stubs.get).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("takes a dismissed task off the count at once", async () => {
    await render(true);
    stubs.post.mockResolvedValue({ tasks: [task({}), DONE] });

    await act(async () => {
      await dismiss?.("probe_videos");
    });
    await advance(0);

    expect(stubs.post).toHaveBeenCalledWith("/upgrade-tasks/probe_videos/dismiss/", {});
    expect(count).toBe(1);
    expect(queryClient.getQueryData(jobKeys.upgradeTasks())).toEqual({ tasks: [task({}), DONE] });
  });

  it("follows a running task, and stops asking when nothing runs", async () => {
    stubs.get.mockResolvedValue({ tasks: [task({ status: "running" })] });
    await render(true);
    await advance(POLL_ACTIVE_MS);
    expect(stubs.get).toHaveBeenCalledTimes(2);

    stubs.get.mockResolvedValue({ tasks: [task({ status: "done" })] });
    await advance(POLL_ACTIVE_MS);
    expect(stubs.get).toHaveBeenCalledTimes(3);
    await advance(POLL_IDLE_MS * 2);
    expect(stubs.get).toHaveBeenCalledTimes(3);
    expect(count).toBe(0);
  });
});
