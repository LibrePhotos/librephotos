/**
 * Detect faces again on one photo answers in its People section (#1117): the scan is followed to
 * its end, the photo's details are fetched again, and the faces it added are told apart.
 */
import type { Job } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { detectFacesReports } from "../detectFacesReports";
import { useDetectFacesReport, type DetectFacesOutcome } from "./useDetectFacesReport";

type Ended = Pick<Job, "job_id" | "failed">;

const followed = vi.hoisted(() => ({ jobId: null as string | null, onEnded: (_job: Ended) => {} }));
vi.mock("../../jobs/hooks/useFollowOwnJob", () => ({
  useFollowOwnJob: (jobId: string | null, onEnded: (job: Ended) => void) => {
    followed.jobId = jobId;
    followed.onEnded = onEnded;
    return undefined;
  },
}));

const ended = (failed = false): Ended => ({ job_id: "j1", failed });

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const unmounts: (() => void)[] = [];
afterEach(() => {
  while (unmounts.length) defined(unmounts.pop())();
  detectFacesReports.dismiss("p1");
});

async function render(photoId: string | undefined, faceIds: readonly number[]) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  let latest: DetectFacesOutcome | null = null;
  let ids = faceIds;
  function Host() {
    latest = useDetectFacesReport(photoId, ids);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const draw = () =>
    root.render(
      <QueryClientProvider client={client}>
        <Host />
      </QueryClientProvider>
    );
  await act(async () => draw());
  unmounts.push(() => act(() => root.unmount()));
  return {
    current: () => latest,
    invalidate,
    withFaces: async (next: readonly number[]) => {
      ids = next;
      await act(async () => draw());
    },
  };
}

describe("useDetectFacesReport", () => {
  it("has nothing to say about a photo that was not scanned", async () => {
    const hook = await render("p1", [1]);

    expect(hook.current()).toBeNull();
    expect(followed.jobId).toBeNull();
  });

  it("follows the scan and marks the faces it found as new", async () => {
    detectFacesReports.start("p1", "j1");
    const hook = await render("p1", [1, 2]);
    expect(hook.current()?.state).toBe("running");
    expect(followed.jobId).toBe("j1");

    await act(async () => followed.onEnded(ended()));
    expect(hook.invalidate).toHaveBeenCalled();
    await hook.withFaces([1, 2, 3]);

    expect(hook.current()).toMatchObject({ state: "found", newFaceIds: [3] });
    expect(followed.jobId).toBeNull();
  });

  it("says when it found nothing new", async () => {
    detectFacesReports.start("p1", "j1");
    const hook = await render("p1", [1]);

    await act(async () => followed.onEnded(ended()));

    expect(hook.current()).toMatchObject({ state: "none", newFaceIds: [] });
  });

  it("says when the scan failed, and goes away once dismissed", async () => {
    detectFacesReports.start("p1", "j1");
    const hook = await render("p1", []);

    await act(async () => followed.onEnded(ended(true)));
    expect(hook.current()?.state).toBe("failed");

    await act(async () => defined(hook.current()).dismiss());
    expect(hook.current()).toBeNull();
  });

  it("ignores the end of another job", async () => {
    detectFacesReports.start("p1", "j2");
    const hook = await render("p1", []);

    await act(async () => followed.onEnded(ended()));

    expect(hook.current()?.state).toBe("running");
  });

  it("follows nothing without a photo", async () => {
    detectFacesReports.start("p1", "j1");
    const hook = await render(undefined, []);
    await act(async () => followed.onEnded(ended()));

    expect(hook.current()).toBeNull();
    expect(detectFacesReports.get("p1")?.state).toBe("running");
  });
});
