/**
 * "Write metadata to files" (#2287): the button POSTs /api/savemetadata/, says the job started,
 * follows it, and once it ended says how many photos were written and how many could not be.
 */
import type { Job } from "@librephotos/api-client";
import { jobKeys, settingsKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { jobFixture } from "../../../components/job/jobFixture.test-utils";
import { fakeJobServer } from "../jobServer.test-utils";
import { reportWriteMetadata, useWriteMetadataToFiles } from "./useWriteMetadataToFiles";

type EndedJob = Pick<Job, "job_id" | "finished" | "failed" | "cancelled" | "result">;

const stubs = vi.hoisted(() => ({
  notification: {
    writeMetadataStarted: vi.fn<() => void>(),
    writeMetadataDone: vi.fn<(written: number, failed: number) => void>(),
    writeMetadataFailed: vi.fn<() => void>(),
    jobCancelled: vi.fn<() => void>(),
    jobAlreadyRunning: vi.fn<() => void>(),
    serverError: vi.fn<() => void>(),
  },
}));

vi.mock("../../../service/notifications", () => ({ notification: stubs.notification }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const ended = (fields: Partial<EndedJob>): EndedJob => ({
  job_id: "j1",
  finished: true,
  failed: false,
  cancelled: false,
  result: { written: 4060, skipped: 0, error_count: 42, types: ["ratings"] },
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

describe("useWriteMetadataToFiles", () => {
  it("starts the job, follows it and reports the counts", async () => {
    const server = fakeJobServer(url =>
      url.pathname === "/api/savemetadata/"
        ? new Response(JSON.stringify({ job_id: "j1", types: ["ratings"] }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
          })
        : undefined
    );
    server.setJobs([jobFixture({ job_id: "j1", job_type_str: "Write metadata" })]);
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    let latest: ReturnType<typeof useWriteMetadataToFiles> | undefined;
    function Host() {
      latest = useWriteMetadataToFiles();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const render = () =>
      act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <Host />
          </QueryClientProvider>
        );
      });
    await render();

    await act(async () => latest?.start());
    await flush();
    expect(String(server.fetchMock.mock.calls[0]?.[0])).toContain("/api/savemetadata/");
    expect(stubs.notification.writeMetadataStarted).toHaveBeenCalledOnce();
    expect(latest?.running).toBe(true);
    expect(latest?.job?.progress_current).toBe(50);

    server.setJobs([jobFixture({ ...ended({}) })]);
    await act(async () => client.refetchQueries({ queryKey: jobKeys.all }));
    await flush();

    expect(stubs.notification.writeMetadataDone).toHaveBeenCalledWith(4060, 42);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsKeys.all });
    expect(latest?.running).toBe(false);
    act(() => root.unmount());
  });
});

describe("reportWriteMetadata", () => {
  it("says a job failed or was cancelled", () => {
    reportWriteMetadata(ended({ failed: true }));
    reportWriteMetadata(ended({ cancelled: true }));
    reportWriteMetadata(ended({ result: null }));

    expect(stubs.notification.writeMetadataFailed).toHaveBeenCalledOnce();
    expect(stubs.notification.jobCancelled).toHaveBeenCalledOnce();
    expect(stubs.notification.writeMetadataDone).toHaveBeenCalledWith(0, 0);
  });
});
