/**
 * Apply date rules to existing photos (#437): the button POSTs /api/photos/reapply-date-rules/, says
 * the job started, follows it, and once it ended says how many photos moved and how many keep the
 * date set by hand.
 */
import type { Job } from "@librephotos/api-client";
import { photoGridKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { reportDateRules, useApplyDateRules } from "./useApplyDateRules";

type EndedJob = Pick<Job, "job_id" | "finished" | "failed" | "cancelled" | "result">;

const stubs = vi.hoisted(() => ({
  jobs: [] as EndedJob[],
  notification: {
    dateRulesStarted: vi.fn<() => void>(),
    dateRulesApplied: vi.fn<(moved: number, kept: number, failed: number) => void>(),
    dateRulesFailed: vi.fn<() => void>(),
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
  result: { moved: 312, unchanged: 20, kept_hand_set: 41 },
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

/** Renders the hook, clicks Apply, then lets the job list report `job`. */
async function applyAndEnd(job: EndedJob) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  let latest: ReturnType<typeof useApplyDateRules> | undefined;
  function Host() {
    latest = useApplyDateRules();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = () =>
    root.render(
      <QueryClientProvider client={client}>
        <Host />
      </QueryClientProvider>
    );
  await act(async () => render());
  act(() => latest?.start());
  await flush();
  const runningWhileQueued = latest?.running;
  stubs.jobs = [job];
  await act(async () => render());
  await flush();
  const runningAfter = latest?.running;
  act(() => root.unmount());
  return { runningWhileQueued, runningAfter, invalidate };
}

describe("useApplyDateRules", () => {
  it("starts the job, follows it, and reports what moved", async () => {
    const fetchMock = respond(200, { status: true, job_id: "j1", job_ids: ["j1"] });

    const { runningWhileQueued, runningAfter, invalidate } = await applyAndEnd(ended({}));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/photos/reapply-date-rules/",
      expect.objectContaining({ method: "POST" })
    );
    expect(stubs.notification.dateRulesStarted).toHaveBeenCalledTimes(1);
    expect(runningWhileQueued).toBe(true);
    expect(stubs.notification.dateRulesApplied).toHaveBeenCalledWith(312, 41, 0);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: photoGridKeys.all });
    expect(runningAfter).toBe(false);
  });

  it("follows the job already running instead of starting another", async () => {
    respond(409, { errors: [{ code: "job_already_running", message: "Already running", job_id: "j0" }] });

    await applyAndEnd(ended({ job_id: "j0" }));

    expect(stubs.notification.jobAlreadyRunning).toHaveBeenCalledTimes(1);
    expect(stubs.notification.dateRulesStarted).not.toHaveBeenCalled();
    expect(stubs.notification.dateRulesApplied).toHaveBeenCalledWith(312, 41, 0);
  });
});

describe("reportDateRules", () => {
  it("says a cancelled job was cancelled", () => {
    reportDateRules(ended({ cancelled: true, result: { status: "cancelled" } }));
    expect(stubs.notification.jobCancelled).toHaveBeenCalledTimes(1);
    expect(stubs.notification.dateRulesApplied).not.toHaveBeenCalled();
  });

  it("says a failed job failed", () => {
    reportDateRules(ended({ failed: true, result: { status: "failed", error: "broker down" } }));
    expect(stubs.notification.dateRulesFailed).toHaveBeenCalledTimes(1);
  });

  it("counts the photos it could not read", () => {
    reportDateRules(ended({ result: { moved: 3, kept_hand_set: 0, error_count: 2, status: "partial_failure" } }));
    expect(stubs.notification.dateRulesApplied).toHaveBeenCalledWith(3, 0, 2);
  });

  it("reads a result without counts as nothing moved", () => {
    reportDateRules(ended({ result: null }));
    expect(stubs.notification.dateRulesApplied).toHaveBeenCalledWith(0, 0, 0);
  });
});
