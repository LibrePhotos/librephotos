/**
 * The web's star rating (#2202) posts to /photosedit/rating/ and refreshes
 * every photo grid and the rated photo's details.
 */
import { photoGridKeys, photoKeys, Photoset } from "@librephotos/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { queryClient } from "../../api";
import { useSetPhotosRatingMutation } from "./useSetPhotosRatingMutation";

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  setPhotosRating: vi.fn<(numberOfPhotos: number, rating: number) => void>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  apiClient: { post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args) },
}));
vi.mock("../../../service/notifications", () => ({ notification: { setPhotosRating: stubs.setPhotosRating } }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  queryClient.clear();
  stubs.post.mockReset();
  stubs.setPhotosRating.mockReset();
});

const isStale = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey)?.isInvalidated;

async function rate(request: { image_hashes: string[]; rating: number }) {
  let mutation: ReturnType<typeof useSetPhotosRatingMutation> | undefined;
  function Probe() {
    mutation = useSetPhotosRatingMutation();
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
    await defined(mutation).mutateAsync(request);
  });
  await act(async () => root.unmount());
}

describe("useSetPhotosRatingMutation", () => {
  it("posts the hashes and the rating, and refreshes the grids and the photo", async () => {
    stubs.post.mockResolvedValue({ status: true, count: 1, updated_hashes: ["a"], not_updated_hashes: [] });
    const timeline = photoGridKeys.dateAlbumList([Photoset.NONE, undefined, undefined, undefined, "all", ""]);
    const detail = photoKeys.detail("a");
    [timeline, detail].forEach(queryKey => queryClient.setQueryData(queryKey, {}));

    await rate({ image_hashes: ["a"], rating: 4 });

    expect(stubs.post).toHaveBeenCalledWith("/photosedit/rating/", { image_hashes: ["a"], rating: 4 });
    expect(stubs.setPhotosRating).toHaveBeenCalledWith(1, 4);
    expect(isStale(timeline)).toBe(true);
    expect(isStale(detail)).toBe(true);
  });

  it("rates several photos in one request", async () => {
    stubs.post.mockResolvedValue({ status: true, count: 2 });

    await rate({ image_hashes: ["a", "b"], rating: 0 });

    expect(stubs.post).toHaveBeenCalledWith("/photosedit/rating/", { image_hashes: ["a", "b"], rating: 0 });
    expect(stubs.setPhotosRating).toHaveBeenCalledWith(2, 0);
  });
});
