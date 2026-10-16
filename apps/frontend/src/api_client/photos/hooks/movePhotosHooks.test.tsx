/**
 * The hooks behind "Move to folder…" (#352): the preview of a move, the folder listing, and the
 * move itself with its toast, its refreshes and the job a large move runs in.
 */
import { ApiError, folderKeys, photoKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";

type Counts = { moved: number; skipped: number; refused: number; failed: number; target_folder: string };

const MOVED = { target_folder: "/p/b", moved: 2, skipped: 1, unchanged: 0, refused: 0, failed: 0 };
const PREVIEW = { target_folder: "/p/b", photos: 2, files: 3, unchanged: 0, refused: [], clashes: [] };
const LISTING = { path: null, folders: [{ name: "p", path: "/p", has_subfolders: true }], truncated: false };

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  photosMoved: vi.fn<(counts: Counts, folder: string) => void>(),
  movePhotosStarted: vi.fn<() => void>(),
  photosMoveFailed: vi.fn<(reason: string | null) => void>(),
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get, post: stubs.post } }));
vi.mock("../../../service/notifications", () => ({
  notification: {
    photosMoved: stubs.photosMoved,
    movePhotosStarted: stubs.movePhotosStarted,
    photosMoveFailed: stubs.photosMoveFailed,
  },
}));
// The job is polled at once in the test, not after POLL_ACTIVE_MS.
vi.mock("@librephotos/api-client", async importOriginal => ({
  ...(await importOriginal<typeof import("@librephotos/api-client")>()),
  POLL_ACTIVE_MS: 0,
}));

const { useMovePreviewQuery } = await import("./useMovePreviewQuery");
const { isNameConflict, useMovePhotosMutation } = await import("./useMovePhotosMutation");
const { useMoveFoldersQuery } = await import("../../folders/hooks/useMoveFoldersQuery");

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

async function settle(times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    });
  }
}

const SELECTION = { image_hashes: ["h1", "h2"] };

describe("useMovePreviewQuery", () => {
  it("asks about the folder picked and keys the answer by selection and folder", async () => {
    stubs.post.mockResolvedValue(PREVIEW);
    const { client, unmount } = await renderHook(() => useMovePreviewQuery(SELECTION, "/p/b"));
    await settle();
    await unmount();

    expect(stubs.post).toHaveBeenCalledWith("/photos/move/preview/", {
      image_hashes: ["h1", "h2"],
      target_folder: "/p/b",
    });
    expect(client.getQueryData(photoKeys.movePreview(SELECTION, "/p/b"))).toEqual(PREVIEW);
  });

  it("asks nothing before a folder is picked", async () => {
    const { unmount } = await renderHook(() => useMovePreviewQuery(SELECTION, null));
    await unmount();
    expect(stubs.post).not.toHaveBeenCalled();
  });
});

describe("useMoveFoldersQuery", () => {
  it("lists the library folders, and a folder only when it is opened", async () => {
    stubs.get.mockResolvedValue(LISTING);
    const { client, unmount } = await renderHook(() => {
      useMoveFoldersQuery("/p", false);
      return useMoveFoldersQuery(null);
    });
    await settle();
    await unmount();

    expect(stubs.get.mock.calls).toEqual([["/photos/move/folders/"]]);
    expect(client.getQueryData(folderKeys.moveTargets(null))).toEqual(LISTING);
  });
});

describe("useMovePhotosMutation", () => {
  it("moves a small selection in the request, says so and refreshes the grids and folders", async () => {
    stubs.post.mockResolvedValue(MOVED);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, unmount } = await renderHook(() => useMovePhotosMutation(), client);

    await act(async () => {
      await defined(result.current).mutateAsync({ selection: SELECTION, targetFolder: "/p/b" });
    });
    await unmount();

    expect(stubs.post).toHaveBeenCalledWith("/photos/move/", { image_hashes: ["h1", "h2"], target_folder: "/p/b" });
    expect(stubs.photosMoved).toHaveBeenCalledWith(MOVED, "b");
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      expect.arrayContaining([["photoGrid"], ["albums", "folders"], ["folders"]])
    );
  });

  it("follows the job of a large move to its end and reports its counts", async () => {
    stubs.post.mockResolvedValue({ job_id: "j1", target_folder: "/p/b" });
    const job = (finished: boolean) => ({
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 1,
          job_id: "j1",
          queued_at: "2026-10-16T08:00:00Z",
          started_at: null,
          finished_at: null,
          finished,
          failed: false,
          cancelled: false,
          job_type: 28,
          job_type_str: "Move Photos",
          started_by: { id: 1, username: "me", first_name: "", last_name: "" },
          result: finished ? { moved: 150, skipped: 0, refused: 2, failed: 0, unchanged: 0 } : null,
        },
      ],
    });
    stubs.get.mockResolvedValueOnce(job(false)).mockResolvedValue(job(true));
    const { result, unmount } = await renderHook(() => useMovePhotosMutation());

    await act(async () => {
      await defined(result.current).mutateAsync({ selection: SELECTION, targetFolder: "/p/b", onConflict: "skip" });
    });
    await unmount();

    expect(defined(stubs.post.mock.calls[0])[1]).toMatchObject({ on_conflict: "skip" });
    expect(stubs.movePhotosStarted).toHaveBeenCalled();
    expect(stubs.photosMoved).toHaveBeenCalledWith(
      {
        target_folder: "/p/b",
        moved: 150,
        skipped: 0,
        refused: 2,
        failed: 0,
      },
      "b"
    );
  });

  it("leaves a taken name to the dialog and reports any other failure", async () => {
    const conflict = new ApiError(409, "/photos/move/", "conflict", {
      errors: [{ field: "detail", message: "taken", code: "name_conflict" }],
    });
    expect(isNameConflict(conflict)).toBe(true);
    stubs.post.mockRejectedValueOnce(conflict);
    const { result, unmount } = await renderHook(() => useMovePhotosMutation());
    await act(async () => {
      await defined(result.current)
        .mutateAsync({ selection: SELECTION, targetFolder: "/p/b" })
        .catch(() => undefined);
    });
    expect(stubs.photosMoveFailed).not.toHaveBeenCalled();

    stubs.post.mockRejectedValueOnce(new ApiError(400, "/photos/move/", "bad", undefined, "Not in your library."));
    await act(async () => {
      await defined(result.current)
        .mutateAsync({ selection: SELECTION, targetFolder: "/x" })
        .catch(() => undefined);
    });
    await unmount();
    expect(stubs.photosMoveFailed).toHaveBeenCalledWith("Not in your library.");
  });
});
