/**
 * invalidatePhotoLists listed every photo grid but the shared ones, so a favourite (or hide, trash,
 * date) change left "Shared with me" and "Shared by me" showing the old stars until a reload.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { UserAlbumQueryKeys } from "../../albums/hooks/useFetchUserAlbumQuery";
import { queryClient } from "../../api";
import { SharedPhotosByMeQueryKeys } from "./useFetchSharedPhotosByMeQuery";
import { SharedPhotosWithMeQueryKeys } from "./useFetchSharedPhotosWithMeQuery";
import { useSetFavoritePhotosMutation } from "./useSetFavoritePhotosMutation";

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  fetchClient: { post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args) },
}));
vi.mock("../../../service/notifications", () => ({ notification: { togglePhotosFavorite: () => {} } }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => queryClient.clear());

const isStale = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey)?.isInvalidated;

describe("useSetFavoritePhotosMutation", () => {
  it("marks every photo grid stale: the timeline, a user album and the shared grids", async () => {
    stubs.post.mockResolvedValue({ status: true, updated_hashes: ["a"] });
    const timeline = [...DateAlbumsQueryKeys, "none"];
    const userAlbum = [...UserAlbumQueryKeys, "7", false, "", "all"];
    const sharedWithMe = [...SharedPhotosWithMeQueryKeys];
    const sharedByMe = [...SharedPhotosByMeQueryKeys];
    [timeline, userAlbum, sharedWithMe, sharedByMe].forEach(queryKey => queryClient.setQueryData(queryKey, []));

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
      await defined(mutation).mutateAsync({ image_hashes: ["a"], favorite: true });
    });
    await act(async () => root.unmount());

    expect(isStale(timeline)).toBe(true);
    expect(isStale(userAlbum)).toBe(true);
    expect(isStale(sharedWithMe)).toBe(true);
    expect(isStale(sharedByMe)).toBe(true);
  });
});
