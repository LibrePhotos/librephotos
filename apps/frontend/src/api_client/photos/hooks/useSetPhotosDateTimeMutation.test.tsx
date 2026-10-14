/**
 * The bulk date change (#2278) posts to /photosedit/datetime/, reports the changed and skipped
 * photos, and refreshes every grid, the month counts and the photos' details.
 */
import { photoGridKeys, photoKeys, Photoset, statsKeys } from "@librephotos/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { queryClient } from "../../api";
import { useSetPhotosDateTimeMutation, type SetPhotosDateTimeRequest } from "./useSetPhotosDateTimeMutation";

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  photosDateChanged: vi.fn<(changed: number, skipped: number) => void>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  apiClient: { post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args) },
}));
vi.mock("../../../service/notifications", () => ({
  notification: { photosDateChanged: stubs.photosDateChanged },
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  queryClient.clear();
  stubs.post.mockReset();
  stubs.photosDateChanged.mockReset();
});

const isStale = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey)?.isInvalidated;

async function change(request: SetPhotosDateTimeRequest) {
  let mutation: ReturnType<typeof useSetPhotosDateTimeMutation> | undefined;
  function Probe() {
    mutation = useSetPhotosDateTimeMutation();
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

describe("useSetPhotosDateTimeMutation", () => {
  it("shifts the photos and refreshes what shows their dates", async () => {
    stubs.post.mockResolvedValue({ count: 2, skipped_without_date: 1 });
    const timeline = photoGridKeys.dateAlbumList([Photoset.NONE, undefined, undefined, undefined, "all", ""]);
    const keys = [timeline, statsKeys.photoMonthCounts(), photoKeys.detail("a")];
    keys.forEach(queryKey => queryClient.setQueryData(queryKey, {}));

    await change({ selection: { image_hashes: ["a", "b", "c"] }, change: { mode: "shift", seconds: -3600 } });

    expect(stubs.post).toHaveBeenCalledWith("/photosedit/datetime/", {
      image_hashes: ["a", "b", "c"],
      mode: "shift",
      seconds: -3600,
    });
    expect(stubs.photosDateChanged).toHaveBeenCalledWith(2, 1);
    keys.forEach(queryKey => expect(isStale(queryKey)).toBe(true));
  });

  it("sets a selected-all set to one date", async () => {
    stubs.post.mockResolvedValue({ count: 40, skipped_without_date: 0 });

    await change({
      selection: { select_all: true, query: { no_timestamp: true }, excluded_hashes: ["x"] },
      change: { mode: "set", datetime: "2025-10-11T10:18:00.000Z" },
    });

    expect(stubs.post).toHaveBeenCalledWith("/photosedit/datetime/", {
      select_all: true,
      query: { no_timestamp: true },
      excluded_hashes: ["x"],
      mode: "set",
      datetime: "2025-10-11T10:18:00.000Z",
    });
    expect(stubs.photosDateChanged).toHaveBeenCalledWith(40, 0);
  });
});
