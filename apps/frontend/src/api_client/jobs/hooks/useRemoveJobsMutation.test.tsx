/**
 * "Remove finished jobs" (#2908) removes the jobs one after another. A job already gone or kept by
 * the server as the scan baseline is skipped; any other failure stops the run. The job lists
 * refresh either way, so they show what was removed.
 */
import { jobKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useRemoveJobsMutation } from "./useRemoveJobsMutation";

vi.mock("../../../service/notifications", () => ({ notification: { serverError: () => {} } }));

const LIST = jobKeys.list({ page: 1, pageSize: 10 });

let queryClient = new QueryClient();
let requested: string[] = [];

const gone = () => Response.json({ errors: [{ field: null, message: "No", code: "not_found" }] }, { status: 404 });
const baseline = () =>
  Response.json({ errors: [{ field: null, message: "Reference", code: "scan_baseline" }] }, { status: 409 });
const broken = () => Response.json({ errors: [{ field: null, message: "Boom", code: "error" }] }, { status: 500 });

/** Remove `ids`, the server answering each one with `answers[id]` (204 when it has none). */
async function removeJobs(ids: number[], answers: Record<number, () => Response> = {}) {
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async input => {
      const url = String(input);
      requested.push(url);
      const id = Number(/\/jobs\/(\d+)\//.exec(url)?.[1]);
      return answers[id]?.() ?? new Response(null, { status: 204 });
    })
  );
  let remove: ((jobIds: number[]) => Promise<number>) | undefined;
  function Host() {
    remove = useRemoveJobsMutation().mutateAsync;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Host />
      </QueryClientProvider>
    );
  });
  let outcome: { removed?: number; error?: unknown } = {};
  await act(async () => {
    outcome = await (remove?.(ids).then(
      removed => ({ removed }),
      (error: unknown) => ({ error })
    ) ?? Promise.resolve({}));
  });
  act(() => root.unmount());
  return outcome;
}

const removedIds = () => requested.map(url => Number(/\/jobs\/(\d+)\//.exec(url)?.[1]));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  queryClient = new QueryClient();
  queryClient.setQueryData(LIST, "cached");
  queryClient.setQueryData(jobKeys.every(true), "cached");
  queryClient.setQueryData(jobKeys.worker(), "cached");
});

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

describe("useRemoveJobsMutation", () => {
  it("removes every job in turn and answers how many it removed", async () => {
    const outcome = await removeJobs([4, 5, 6]);

    expect(removedIds()).toEqual([4, 5, 6]);
    expect(outcome.removed).toBe(3);
  });

  it("removes nothing, and asks nothing, for no jobs", async () => {
    const outcome = await removeJobs([]);

    expect(requested).toEqual([]);
    expect(outcome.removed).toBe(0);
  });

  it("skips a job that is already gone or that the server keeps as the scan baseline", async () => {
    const outcome = await removeJobs([4, 5, 6, 7], { 5: gone, 6: baseline });

    expect(removedIds()).toEqual([4, 5, 6, 7]);
    expect(outcome.removed).toBe(2);
  });

  it("stops at any other failure and removes no further job", async () => {
    const outcome = await removeJobs([4, 5, 6], { 5: broken });

    expect(removedIds()).toEqual([4, 5]);
    expect(outcome.error).toBeDefined();
  });

  it.each([
    ["a run that removed every job", {}],
    ["a run that failed partway", { 5: broken }],
  ])("refreshes the job lists, the bulk list and the worker status after %s", async (_name, answers) => {
    await removeJobs([4, 5, 6], answers);

    for (const key of [LIST, jobKeys.every(true), jobKeys.worker()]) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
  });
});
