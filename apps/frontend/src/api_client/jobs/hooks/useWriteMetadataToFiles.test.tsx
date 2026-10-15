/**
 * "Write metadata to files" (#2287): the button POSTs /api/savemetadata/, says the job started,
 * follows it, and once it ended says how many photos were written and how many could not be.
 */
import type { Job } from "@librephotos/api-client";
import { settingsKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { reportWriteMetadata, useWriteMetadataToFiles } from "./useWriteMetadataToFiles";

type EndedJob = Pick<Job, "job_id" | "finished" | "failed" | "cancelled" | "result">;

const stubs = vi.hoisted(() => ({
  jobs: [] as EndedJob[],
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
vi.mock("./useJobsQuery", () => ({
  useJobsQuery: () => ({ data: { results: stubs.jobs } }),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  stubs.jobs = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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
    const fetchMock = respond(202, { job_id: "j1", types: ["ratings"] });
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
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/savemetadata/");
    expect(stubs.notification.writeMetadataStarted).toHaveBeenCalledOnce();
    expect(latest?.running).toBe(true);

    stubs.jobs = [ended({})];
    await render();
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
