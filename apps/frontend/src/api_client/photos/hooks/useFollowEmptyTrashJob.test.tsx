/**
 * Following the Empty trash job (#2203): once it ends, one toast says how it went, the photo grids
 * and counts refresh, and the follow stops.
 */
import type { Job } from "@librephotos/api-client";
import { photoGridKeys, statsKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { reportEmptyTrash, useFollowEmptyTrashJob } from "./useFollowEmptyTrashJob";

type EndedJob = Pick<Job, "job_id" | "finished" | "failed" | "cancelled" | "result">;

const stubs = vi.hoisted(() => ({
  jobs: [] as EndedJob[],
  enabled: [] as (boolean | undefined)[],
  notification: {
    jobCancelled: vi.fn<() => void>(),
    trashEmptied: vi.fn<(count: number) => void>(),
    trashEmptiedWithErrors: vi.fn<(deleted: number, failed: number) => void>(),
    trashEmptyFailed: vi.fn<() => void>(),
  },
}));

vi.mock("../../../service/notifications", () => ({ notification: stubs.notification }));
vi.mock("../../jobs/hooks/useJobsQuery", () => ({
  useJobsQuery: (_params: unknown, options: { enabled?: boolean }) => {
    stubs.enabled.push(options.enabled);
    return { data: { results: stubs.jobs } };
  },
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  stubs.jobs = [];
  stubs.enabled = [];
  vi.clearAllMocks();
});

const job = (fields: Partial<EndedJob>): EndedJob => ({
  job_id: "job-uuid",
  finished: true,
  failed: false,
  cancelled: false,
  result: { status: "completed", deleted: 12, failed_count: 0 },
  ...fields,
});

async function follow(jobId: string | null) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onEnded = vi.fn<() => void>();
  function Host() {
    useFollowEmptyTrashJob(jobId, onEnded);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Host />
      </QueryClientProvider>
    );
  });
  act(() => root.unmount());
  return { invalidate, onEnded };
}

describe("useFollowEmptyTrashJob", () => {
  it("reports the ended job, refreshes the grids and counts, and stops following", async () => {
    stubs.jobs = [job({ job_id: "other", finished: false }), job({})];
    const { invalidate, onEnded } = await follow("job-uuid");

    expect(stubs.notification.trashEmptied).toHaveBeenCalledWith(12);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: photoGridKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: statsKeys.counts() });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("waits while the job runs", async () => {
    stubs.jobs = [job({ finished: false })];
    const { onEnded } = await follow("job-uuid");

    expect(onEnded).not.toHaveBeenCalled();
    expect(stubs.notification.trashEmptied).not.toHaveBeenCalled();
  });

  it("does not read the job list while nothing is followed", async () => {
    stubs.jobs = [job({})];
    const { onEnded } = await follow(null);

    expect(stubs.enabled).toEqual([false]);
    expect(onEnded).not.toHaveBeenCalled();
  });
});

describe("reportEmptyTrash", () => {
  it("says how many photos were deleted", () => {
    reportEmptyTrash(job({}));
    expect(stubs.notification.trashEmptied).toHaveBeenCalledWith(12);
  });

  it("names the photos left behind", () => {
    reportEmptyTrash(job({ failed: true, result: { status: "failed", deleted: 9, failed_count: 3 } }));
    expect(stubs.notification.trashEmptiedWithErrors).toHaveBeenCalledWith(9, 3);
  });

  it("says it failed when the job has no counts", () => {
    reportEmptyTrash(job({ failed: true, result: { status: "failed", error: "boom" } }));
    reportEmptyTrash(job({ failed: true, result: { status: "failed", deleted: 0, failed_count: 0 } }));
    expect(stubs.notification.trashEmptyFailed).toHaveBeenCalledTimes(2);
  });

  it("says a cancelled job was cancelled", () => {
    reportEmptyTrash(job({ cancelled: true, result: { status: "cancelled" } }));
    expect(stubs.notification.jobCancelled).toHaveBeenCalled();
    expect(stubs.notification.trashEmptied).not.toHaveBeenCalled();
  });
});
