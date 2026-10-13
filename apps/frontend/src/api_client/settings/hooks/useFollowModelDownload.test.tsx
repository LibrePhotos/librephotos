/**
 * The Features card follows a running model download through the job, not by polling the site
 * settings (the settings form re-reads its fields on every settings fetch). When the job ends, the
 * settings are fetched once more for the models now on disk.
 */
import { POLL_ACTIVE_MS, settingsKeys } from "@librephotos/api-client";
import type { SiteModelDownload } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useFollowModelDownload } from "./useFollowModelDownload";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get } }));

const user = { id: 1, username: "admin", first_name: "", last_name: "" };
function job(progress: number, flags: { finished?: boolean; failed?: boolean; cancelled?: boolean } = {}) {
  return {
    id: 9,
    job_id: "a",
    queued_at: "2026-10-13T10:00:00Z",
    started_at: "2026-10-13T10:00:01Z",
    finished_at: null,
    finished: false,
    failed: false,
    cancelled: false,
    job_type: 10,
    job_type_str: "Download Models",
    started_by: user,
    progress_current: progress,
    progress_target: 12,
    ...flags,
  };
}

let root: Root | undefined;
let queryClient: QueryClient;
let shown: SiteModelDownload | null | undefined;

function Harness({ download }: { download: SiteModelDownload | null }) {
  shown = useFollowModelDownload(download);
  return null;
}

async function render(download: SiteModelDownload | null) {
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Harness download={download} />
      </QueryClientProvider>
    );
  });
  // Let the job request answer.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
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
  shown = undefined;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  queryClient.clear();
  vi.useRealTimers();
});

const running = { id: 9, status: "running", progress_current: 1, progress_target: 12 };

describe("useFollowModelDownload", () => {
  it("asks for nothing while no download runs", async () => {
    const failed = { ...running, status: "failed" };
    await render(failed);
    await advance(POLL_ACTIVE_MS * 3);
    expect(stubs.get).not.toHaveBeenCalled();
    expect(shown).toEqual(failed);
    await render(null);
    expect(shown).toBeNull();
  });

  it("follows the running job's progress", async () => {
    stubs.get.mockResolvedValueOnce(job(3)).mockResolvedValue(job(6));
    await render(running);
    expect(stubs.get).toHaveBeenCalledWith("/jobs/9/");
    expect(shown).toEqual({ id: 9, status: "running", progress_current: 3, progress_target: 12 });
    await advance(POLL_ACTIVE_MS + 10);
    expect(shown?.progress_current).toBe(6);
  });

  it("reloads the settings once the job has ended, and says how it ended", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    stubs.get.mockResolvedValue(job(12, { finished: true, failed: true }));
    await render(running);
    expect(shown?.status).toBe("failed");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.site() });
    await advance(POLL_ACTIVE_MS * 3);
    expect(stubs.get).toHaveBeenCalledTimes(1);
  });

  it("names a finished and a cancelled job", async () => {
    stubs.get.mockResolvedValue(job(12, { finished: true }));
    await render(running);
    expect(shown?.status).toBe("finished");
    queryClient.clear();
    stubs.get.mockResolvedValue(job(4, { finished: true, cancelled: true }));
    await render({ ...running, id: 10 });
    expect(shown?.status).toBe("cancelled");
  });
});
