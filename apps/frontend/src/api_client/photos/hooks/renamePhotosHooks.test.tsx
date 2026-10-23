/**
 * The hooks behind "Rename files…" (#2773): the preview of a rename, and the rename itself with its
 * toast, its refreshes and the job a large rename runs in.
 */
import { ApiError, photoKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";

type Counts = { renamed: number; unchanged: number; undated: number; refused: number; failed: number };

const RENAMED = { renamed: 2, unchanged: 0, undated: 1, refused: 0, failed: 0 };
const PREVIEW = {
  photos: 2,
  files: 2,
  unchanged: 0,
  undated: 0,
  undated_hashes: [],
  numbered: 0,
  no_free_name: 0,
  refused: [],
  rows: [],
};
const PATTERN = "{year}_{name}";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  photosRenamed: vi.fn<(counts: Counts) => void>(),
  renamePhotosStarted: vi.fn<() => void>(),
  photosRenameFailed: vi.fn<(reason: string | null) => void>(),
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get, post: stubs.post } }));
vi.mock("../../../service/notifications", () => ({
  notification: {
    photosRenamed: stubs.photosRenamed,
    renamePhotosStarted: stubs.renamePhotosStarted,
    photosRenameFailed: stubs.photosRenameFailed,
  },
}));
// The job is polled at once in the test, not after POLL_ACTIVE_MS.
vi.mock("@librephotos/api-client", async importOriginal => ({
  ...(await importOriginal<typeof import("@librephotos/api-client")>()),
  POLL_ACTIVE_MS: 0,
}));

const { useRenamePreviewQuery } = await import("./useRenamePreviewQuery");
const { useRenamePhotosMutation } = await import("./useRenamePhotosMutation");

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function renderHook<T>(hook: () => T, client = new QueryClient()) {
  const result: { current?: T } = {};
  function Probe() {
    result.current = hook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
  return { client, result, unmount: () => act(async () => root.unmount()) };
}

async function settle() {
  await act(async () => {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  });
}

const SELECTION = { image_hashes: ["h1", "h2"] };

const jobPage = (finished: boolean, failed = false) => ({
  count: 1,
  next: null,
  previous: null,
  results: [
    {
      id: 1,
      job_id: "j1",
      queued_at: "2026-10-22T08:00:00Z",
      started_at: null,
      finished_at: null,
      finished,
      failed,
      cancelled: false,
      job_type: 31,
      job_type_str: "Rename Photos",
      started_by: { id: 1, username: "me", first_name: "", last_name: "" },
      result: finished && !failed ? { renamed: 150, undated: 3 } : null,
    },
  ],
});

describe("useRenamePreviewQuery", () => {
  it("asks about the pattern and keys the answer by selection and pattern", async () => {
    stubs.post.mockResolvedValue(PREVIEW);
    const { client, unmount } = await renderHook(() => useRenamePreviewQuery(SELECTION, PATTERN));
    await settle();
    await unmount();

    expect(stubs.post).toHaveBeenCalledWith("/photos/rename/preview/", {
      image_hashes: ["h1", "h2"],
      pattern: PATTERN,
    });
    expect(client.getQueryData(photoKeys.renamePreview(SELECTION, PATTERN))).toEqual(PREVIEW);
  });

  it("asks nothing without a valid pattern", async () => {
    const { unmount } = await renderHook(() => useRenamePreviewQuery(SELECTION, null));
    await unmount();
    expect(stubs.post).not.toHaveBeenCalled();
  });
});

describe("useRenamePhotosMutation", () => {
  it("renames a small selection in the request, says so and refreshes the grids", async () => {
    stubs.post.mockResolvedValue(RENAMED);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, unmount } = await renderHook(() => useRenamePhotosMutation(), client);

    await act(async () => {
      await defined(result.current).mutateAsync({ selection: SELECTION, pattern: PATTERN });
    });
    await unmount();

    expect(stubs.post).toHaveBeenCalledWith("/photos/rename/", { image_hashes: ["h1", "h2"], pattern: PATTERN });
    expect(stubs.photosRenamed).toHaveBeenCalledWith(RENAMED);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      expect.arrayContaining([["photoGrid"], ["folders"]])
    );
  });

  it("follows the job of a large rename to its end and reports its counts", async () => {
    stubs.post.mockResolvedValue({ job_id: "j1" });
    stubs.get.mockResolvedValueOnce(jobPage(false)).mockResolvedValue(jobPage(true));
    const { result, unmount } = await renderHook(() => useRenamePhotosMutation());

    await act(async () => {
      await defined(result.current).mutateAsync({ selection: SELECTION, pattern: PATTERN });
    });
    await unmount();

    expect(stubs.renamePhotosStarted).toHaveBeenCalled();
    expect(stubs.photosRenamed).toHaveBeenCalledWith({
      renamed: 150,
      unchanged: 0,
      undated: 3,
      refused: 0,
      failed: 0,
    });
  });

  it("reports a failed job and a refused rename", async () => {
    stubs.post.mockResolvedValueOnce({ job_id: "j1" });
    stubs.get.mockResolvedValue(jobPage(true, true));
    const { result, unmount } = await renderHook(() => useRenamePhotosMutation());
    await act(async () => {
      await defined(result.current)
        .mutateAsync({ selection: SELECTION, pattern: PATTERN })
        .catch(() => undefined);
    });
    expect(stubs.photosRenameFailed).toHaveBeenLastCalledWith(null);

    stubs.post.mockRejectedValueOnce(
      new ApiError(409, "/photos/rename/", "conflict", undefined, "A scan of your library is running.")
    );
    await act(async () => {
      await defined(result.current)
        .mutateAsync({ selection: SELECTION, pattern: PATTERN })
        .catch(() => undefined);
    });
    await unmount();
    expect(stubs.photosRenameFailed).toHaveBeenLastCalledWith("A scan of your library is running.");
  });
});
