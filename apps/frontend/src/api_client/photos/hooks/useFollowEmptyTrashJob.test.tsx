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
import { jobFixture } from "../../../components/job/jobFixture.test-utils";
import { followedJobs } from "../../jobs/followedJobs";
import { fakeJobServer } from "../../jobs/jobServer.test-utils";
import { reportEmptyTrash, useFollowEmptyTrashJob } from "./useFollowEmptyTrashJob";

type EndedJob = Pick<Job, "job_id" | "finished" | "failed" | "cancelled" | "result">;

const stubs = vi.hoisted(() => ({
  notification: {
    jobCancelled: vi.fn<() => void>(),
    jobLost: vi.fn<() => void>(),
    trashEmptied: vi.fn<(count: number) => void>(),
    trashEmptiedWithErrors: vi.fn<(deleted: number, failed: number) => void>(),
    trashEmptyFailed: vi.fn<() => void>(),
  },
}));

vi.mock("../../../service/notifications", () => ({ notification: stubs.notification }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const unmounts: (() => void)[] = [];
afterEach(() => {
  while (unmounts.length) unmounts.pop()?.();
  vi.unstubAllGlobals();
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

async function flush() {
  for (let attempt = 0; attempt < 10; attempt++) {
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    });
  }
}

/** Mounts the trash page's follower; `jobs` is the user's job list. */
async function mountFollower(jobs: EndedJob[]) {
  const server = fakeJobServer();
  server.setJobs(jobs.map((fields, index) => jobFixture({ id: index + 1, ...fields })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  let jobId: string | null = null;
  function Host() {
    jobId = useFollowEmptyTrashJob();
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
  await flush();
  let mounted = true;
  const unmount = () => {
    if (mounted) act(() => root.unmount());
    mounted = false;
  };
  unmounts.push(unmount);
  return { invalidate, fetchMock: server.fetchMock, followed: () => jobId, unmount };
}

describe("useFollowEmptyTrashJob", () => {
  it("reports the ended job, refreshes the grids and counts, and stops following", async () => {
    followedJobs.follow("emptyTrash", "ended-uuid");
    const { invalidate, followed } = await mountFollower([
      job({ job_id: "other", finished: false }),
      job({ job_id: "ended-uuid" }),
    ]);

    expect(stubs.notification.trashEmptied).toHaveBeenCalledWith(12);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: photoGridKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: statsKeys.counts() });
    expect(followed()).toBeNull();
  });

  it("waits while the job runs, also on a trash page opened again", async () => {
    followedJobs.follow("emptyTrash", "running-uuid");
    const first = await mountFollower([job({ job_id: "running-uuid", finished: false })]);
    expect(first.followed()).toBe("running-uuid");
    first.unmount();

    const again = await mountFollower([job({ job_id: "running-uuid", finished: false })]);
    expect(again.followed()).toBe("running-uuid");
    expect(stubs.notification.trashEmptied).not.toHaveBeenCalled();
    followedJobs.release("emptyTrash", "running-uuid");
  });

  it("stops waiting, and says so, when the job was removed from the list", async () => {
    followedJobs.follow("emptyTrash", "removed-uuid");
    const { followed } = await mountFollower([job({ job_id: "other" })]);

    expect(stubs.notification.jobLost).toHaveBeenCalledTimes(1);
    expect(stubs.notification.trashEmptied).not.toHaveBeenCalled();
    expect(followed()).toBeNull();
  });

  it("does not read the job list while nothing is followed", async () => {
    const { fetchMock, followed } = await mountFollower([job({})]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(followed()).toBeNull();
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
