/**
 * invalidatePhotoLists listed every photo grid but the shared ones, so a favourite (or hide, trash,
 * date) change left "Shared with me" and "Shared by me" showing the old stars until a reload.
 *
 * The toast's Undo (#127) unfavorites only the photos the server says it favorited: a photo that
 * already was a favorite stays one.
 */
import { photoGridKeys, Photoset } from "@librephotos/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { queryClient } from "../../api";
import { useSetFavoritePhotosMutation } from "./useSetFavoritePhotosMutation";

type Undo = () => Promise<unknown>;

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  toast: vi.fn<(count: number, isFavorite: boolean, undo?: Undo) => void>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  apiClient: { post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args) },
}));
vi.mock("../../../service/notifications", () => ({ notification: { togglePhotosFavorite: stubs.toast } }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  queryClient.clear();
  stubs.post.mockReset();
  stubs.toast.mockReset();
});

const isStale = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey)?.isInvalidated;

/** Runs `use` with the hook, mounted in a QueryClientProvider, and unmounts it. */
async function withMutation(use: (mutation: ReturnType<typeof useSetFavoritePhotosMutation>) => Promise<unknown>) {
  let mutation: ReturnType<typeof useSetFavoritePhotosMutation> | undefined;
  function Probe() {
    mutation = useSetFavoritePhotosMutation();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await use(defined(mutation));
  });
  await act(async () => root.unmount());
}

describe("useSetFavoritePhotosMutation", () => {
  it("marks every photo grid stale: the timeline, a user album and the shared grids", async () => {
    stubs.post.mockResolvedValue({ status: true, updated_hashes: ["a"] });
    const timeline = photoGridKeys.dateAlbumList([Photoset.NONE, undefined, undefined, undefined, "all", ""]);
    const userAlbum = photoGridKeys.userAlbumView("7", false, "", "all");
    const sharedWithMe = photoGridKeys.sharedWithMe();
    const sharedByMe = photoGridKeys.sharedByMe();
    [timeline, userAlbum, sharedWithMe, sharedByMe].forEach(queryKey => queryClient.setQueryData(queryKey, []));

    await withMutation(mutation => mutation.mutateAsync({ image_hashes: ["a"], favorite: true }));

    expect(isStale(timeline)).toBe(true);
    expect(isStale(userAlbum)).toBe(true);
    expect(isStale(sharedWithMe)).toBe(true);
    expect(isStale(sharedByMe)).toBe(true);
  });

  it("gives the toast an Undo that unfavorites only the photos the server favorited", async () => {
    stubs.post.mockResolvedValue({ status: true, count: 1, updated_hashes: ["a"], not_updated_hashes: ["b"] });

    await withMutation(async mutation => {
      await mutation.mutateAsync({ image_hashes: ["a", "b"], favorite: true });
      const [count, isFavorite, undo] = defined(stubs.toast.mock.calls[0]);
      expect([count, isFavorite]).toEqual([1, true]);
      await defined(undo)();
    });

    expect(stubs.post).toHaveBeenLastCalledWith("/photosedit/favorite/", { image_hashes: ["a"], favorite: false });
    // The Undo shows no toast of its own
    expect(stubs.toast).toHaveBeenCalledTimes(1);
  });

  it("offers no Undo for a select-all change, whose answer names no photos", async () => {
    stubs.post.mockResolvedValue({ status: true, count: 40 });

    await withMutation(mutation =>
      mutation.mutateAsync({ select_all: true, query: { archived: false }, favorite: true })
    );

    expect(stubs.toast).toHaveBeenCalledWith(40, true, undefined);
  });

  it("shows no toast when nothing changed", async () => {
    stubs.post.mockResolvedValue({ status: true, count: 0, updated_hashes: [], not_updated_hashes: ["a"] });

    await withMutation(mutation => mutation.mutateAsync({ image_hashes: ["a"], favorite: true }));

    expect(stubs.toast).not.toHaveBeenCalled();
  });
});
