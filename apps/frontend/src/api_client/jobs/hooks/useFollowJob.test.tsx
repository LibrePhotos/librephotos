/**
 * The job follower: a job is looked up by its `job_id` once, then fetched by its own id, so newer
 * jobs that push it off the job list's first page do not hide its end. A job removed meanwhile ("Remove
 * finished jobs") is reported lost instead of being waited on for good, and each end is reported once.
 */
import { ApiError, jobKeys, type JobDetail } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { jobFixture } from "../../../components/job/jobFixture.test-utils";
import { fakeJobServer } from "../jobServer.test-utils";
import { followState, useFollowJob, type JobFollow } from "./useFollowJob";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
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

/** Mounts `followers` components that follow `jobId`; `poll()` stands in for the next poll. */
async function follow(jobId: string, followers = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onEnded = vi.fn<(job: JobDetail) => void>();
  const onLost = vi.fn<() => void>();
  const states: JobFollow[] = [];
  function Follower() {
    states.push(useFollowJob(jobId, onEnded, onLost));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        {Array.from({ length: followers }, (_, index) => (
          <Follower key={index} />
        ))}
      </QueryClientProvider>
    )
  );
  await flush();
  return {
    onEnded,
    onLost,
    state: () => states.at(-1)?.state,
    poll: async () => {
      await act(async () => client.refetchQueries({ queryKey: jobKeys.all }));
      await flush();
    },
    /** The lookup's own poll, which runs only while the job is not found. */
    lookAgain: async () => {
      await act(async () => client.refetchQueries({ queryKey: jobKeys.lookup(jobId) }));
      await flush();
    },
    unmount: () => act(() => root.unmount()),
  };
}

const newer = (count: number) =>
  Array.from({ length: count }, (_, index) => jobFixture({ id: 100 + index, job_id: `newer-${index}` }));

describe("useFollowJob", () => {
  it("reports a job that newer jobs pushed off the first page", async () => {
    const server = fakeJobServer();
    server.setJobs([jobFixture({ id: 7, job_id: "pushed" })]);
    const followed = await follow("pushed");
    expect(followed.state()).toBe("running");

    server.setJobs([...newer(150), jobFixture({ id: 7, job_id: "pushed", finished: true })]);
    await followed.poll();

    expect(followed.onEnded).toHaveBeenCalledTimes(1);
    expect(followed.onEnded.mock.calls[0]?.[0].job_id).toBe("pushed");
    expect(followed.state()).toBe("ended");
    followed.unmount();
  });

  it("says a job removed while it was followed is lost, once", async () => {
    const server = fakeJobServer();
    server.setJobs([jobFixture({ id: 8, job_id: "removed" })]);
    const followed = await follow("removed");

    server.setJobs([]);
    await followed.poll();
    await followed.poll();

    expect(followed.state()).toBe("lost");
    expect(followed.onLost).toHaveBeenCalledTimes(1);
    expect(followed.onEnded).not.toHaveBeenCalled();
    followed.unmount();
  });

  it("says a job missing from the user's whole list is lost", async () => {
    const server = fakeJobServer();
    server.setJobs(newer(3));
    const followed = await follow("never-there");

    expect(followed.state()).toBe("lost");
    expect(followed.onLost).toHaveBeenCalledTimes(1);
    followed.unmount();
  });

  it("keeps looking for a job beyond the first page of a longer list", async () => {
    const server = fakeJobServer();
    server.setJobs([...newer(150), jobFixture({ id: 9, job_id: "queued", started_at: null })]);
    const followed = await follow("queued");
    expect(followed.state()).toBe("finding");

    server.setJobs([jobFixture({ id: 9, job_id: "queued" }), ...newer(150)]);
    await followed.lookAgain();

    expect(followed.state()).toBe("running");
    expect(followed.onLost).not.toHaveBeenCalled();
    followed.unmount();
  });

  it("reports an end once, however many components follow the job and however often they poll", async () => {
    const server = fakeJobServer();
    server.setJobs([jobFixture({ id: 10, job_id: "shared", finished: true })]);
    const followed = await follow("shared", 2);
    await followed.poll();
    await followed.poll();

    expect(followed.onEnded).toHaveBeenCalledTimes(1);
    followed.unmount();
  });
});

describe("followState", () => {
  const job = (fields: Partial<JobDetail>): JobDetail => ({
    ...jobFixture({ job_id: "j" }),
    progress_current: 0,
    progress_target: 1,
    ...fields,
  });

  it("is idle without a job, and finding until the job answers", () => {
    expect(followState(null, undefined, undefined, null).state).toBe("idle");
    expect(followState("j", undefined, undefined, null).state).toBe("finding");
    expect(followState("j", { state: "notYet" }, undefined, null).state).toBe("finding");
  });

  it("ignores another job's answer", () => {
    expect(followState("j", { state: "found", id: 7 }, job({ job_id: "other" }), null).state).toBe("finding");
  });

  it("takes a 404 on a running job as lost, but keeps an end that was seen", () => {
    const notFound = new ApiError(404, "/jobs/7/", "Not found");
    expect(followState("j", { state: "found", id: 7 }, job({}), notFound).state).toBe("lost");
    expect(followState("j", { state: "found", id: 7 }, job({ finished: true }), notFound).state).toBe("ended");
  });
});
