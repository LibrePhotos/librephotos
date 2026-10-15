/**
 * #2213: Remove on the job detail page. Removing a job refreshes the job lists and the worker
 * status (a removed stuck row may have kept the queue busy), but not the removed job's own page,
 * which would otherwise refetch a job that is gone and show a 404 before it navigates away.
 */
import { jobKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeleteJobMutation } from "./useDeleteJobMutation";

vi.mock("../../../service/notifications", () => ({ notification: { serverError: () => {} } }));

const LIST = jobKeys.list({ page: 0, pageSize: 10 });

let queryClient = new QueryClient();

async function removeJob(id: number, answer = () => new Response(null, { status: 204 })) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => answer())
  );
  let remove: ((jobId: number) => Promise<void>) | undefined;
  function Host() {
    remove = useDeleteJobMutation().mutateAsync;
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
  await act(async () => {
    await remove?.(id).catch(() => {});
  });
  act(() => root.unmount());
}

/** Keep `key` on screen, as the open detail page does; the fetch counts refetches. */
function watch(key: readonly unknown[]) {
  const fetchJob = vi.fn<() => Promise<string>>(async () => "refetched");
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: fetchJob, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  return { fetchJob, unsubscribe };
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  queryClient = new QueryClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

describe("useDeleteJobMutation", () => {
  it("refreshes the job lists, the other jobs and the worker status", async () => {
    for (const key of [LIST, jobKeys.detail(8), jobKeys.worker()]) {
      queryClient.setQueryData(key, "cached");
    }

    await removeJob(7);

    for (const key of [LIST, jobKeys.detail(8), jobKeys.worker()]) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
  });

  it("leaves the removed job's open page alone instead of refetching it", async () => {
    queryClient.setQueryData(jobKeys.detail(7), "the job");
    const page = watch(jobKeys.detail(7));

    await removeJob(7);

    expect(queryClient.getQueryState(jobKeys.detail(7))?.isInvalidated).toBe(false);
    expect(page.fetchJob).not.toHaveBeenCalled();
    page.unsubscribe();
  });

  it("refreshes the job lists when the server keeps the scan baseline", async () => {
    queryClient.setQueryData(LIST, "cached");
    const refused = () =>
      Response.json(
        { errors: [{ field: null, message: "This scan is the reference", code: "scan_baseline" }] },
        { status: 409 }
      );

    await removeJob(7, refused);

    expect(queryClient.getQueryState(LIST)?.isInvalidated).toBe(true);
  });

  it("refreshes nothing when another removal fails", async () => {
    queryClient.setQueryData(LIST, "cached");

    await removeJob(7, () =>
      Response.json({ errors: [{ field: null, message: "No", code: "not_found" }] }, { status: 404 })
    );

    expect(queryClient.getQueryState(LIST)?.isInvalidated).toBe(false);
  });

  it("drops the removed job's detail when no page shows it", async () => {
    queryClient.setQueryData(jobKeys.detail(7), "the job");

    await removeJob(7);

    expect(queryClient.getQueryState(jobKeys.detail(7))).toBeUndefined();
  });
});
