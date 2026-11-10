/**
 * The worker's running job is read from the worker status itself, on the same render: it used to be
 * copied into state by an effect, so the first render after an answer still showed no job.
 */
import { jobKeys, type WorkerAvailabilityResponse } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { jobFixture } from "../components/job/jobFixture.test-utils";
import { useWorkerStatus } from "./useWorkerStatus";

vi.mock("../api_client/api", () => ({ apiClient: {} }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("useWorkerStatus", () => {
  it("has the running job on the first render with an answer", async () => {
    const client = new QueryClient();
    const job = { ...jobFixture({ job_id: "scan" }), progress_current: 1, progress_target: 2 };
    const answer: WorkerAvailabilityResponse = { status: true, queue_can_accept_job: false, job_detail: job };
    client.setQueryData(jobKeys.worker(), answer);
    const seen: (string | null)[] = [];
    function Host() {
      seen.push(useWorkerStatus().workerRunningJob?.job_id ?? null);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Host />
        </QueryClientProvider>
      )
    );

    expect(seen[0]).toBe("scan");
    act(() => root.unmount());
  });
});
