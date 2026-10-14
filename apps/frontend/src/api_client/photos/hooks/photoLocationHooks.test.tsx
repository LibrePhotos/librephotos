/**
 * The hooks behind "Set location…" (#2279): the selection's summary, the photos taken nearby in
 * time, and the bulk save with its toast and refreshes.
 */
import { photoKeys, type SetPhotosLocationResponse } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";

const SUMMARY = { count: 2, with_location: 1, places: [], first_taken: null, last_taken: null };
const SAVED: SetPhotosLocationResponse = { count: 1, skipped_with_location: 1, geocoded: true };

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(() => Promise.resolve([])),
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  photosLocationSet: vi.fn<(result: SetPhotosLocationResponse) => void>(),
  requestFailed: vi.fn<(title: string, message: string) => void>(),
  invalidatePlaces: vi.fn<() => void>(),
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get, post: stubs.post } }));
vi.mock("../../../service/notifications", () => ({
  notification: { photosLocationSet: stubs.photosLocationSet, requestFailed: stubs.requestFailed },
}));
vi.mock("../../albums/invalidatePlaces", () => ({ invalidatePlaces: stubs.invalidatePlaces }));

const { useLocatedNearbyQuery } = await import("./useLocatedNearbyQuery");
const { useLocationSummaryQuery } = await import("./useLocationSummaryQuery");
const { useSetPhotosLocationMutation } = await import("./useSetPhotosLocationMutation");

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

describe("useLocatedNearbyQuery", () => {
  it("asks for the window and keys the answer by it", async () => {
    const { client, unmount } = await renderHook(() => useLocatedNearbyQuery({ from: "a", to: "b" }));
    await unmount();

    expect(stubs.get).toHaveBeenCalledWith("/photos/located-nearby-in-time/?from=a&to=b");
    expect(client.getQueryData(photoKeys.locatedNearby("a", "b"))).toEqual([]);
  });

  it("asks nothing without a window", async () => {
    const { unmount } = await renderHook(() => useLocatedNearbyQuery(null));
    await unmount();

    expect(stubs.get).not.toHaveBeenCalled();
  });
});

describe("useLocationSummaryQuery", () => {
  it("posts the selection", async () => {
    stubs.post.mockResolvedValueOnce(SUMMARY);
    const { result, unmount } = await renderHook(() => useLocationSummaryQuery({ image_hashes: ["h1", "h2"] }));
    await settle();

    expect(stubs.post).toHaveBeenCalledWith("/photos/location-summary/", { image_hashes: ["h1", "h2"] });
    expect(result.current?.data).toEqual(SUMMARY);
    await unmount();
  });

  it("asks nothing while the dialog is closed", async () => {
    const { unmount } = await renderHook(() => useLocationSummaryQuery(null));
    await unmount();

    expect(stubs.post).not.toHaveBeenCalled();
  });
});

describe("useSetPhotosLocationMutation", () => {
  it("saves, says how it went and refreshes the places and the photos' details", async () => {
    stubs.post.mockResolvedValueOnce(SAVED);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, unmount } = await renderHook(() => useSetPhotosLocationMutation(), client);

    await act(async () => {
      await defined(result.current).mutateAsync({
        selection: { select_all: true, query: { favorite: true }, excluded_hashes: ["x"] },
        lat: 1,
        lon: 2,
        overwrite: false,
      });
    });

    expect(stubs.post).toHaveBeenCalledWith("/photosedit/location/", {
      select_all: true,
      query: { favorite: true },
      excluded_hashes: ["x"],
      lat: 1,
      lon: 2,
      overwrite: false,
    });
    expect(stubs.photosLocationSet).toHaveBeenCalledWith(SAVED);
    expect(stubs.invalidatePlaces).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: photoKeys.details() });
    await unmount();
  });

  it("reports a failure", async () => {
    stubs.post.mockRejectedValueOnce(new Error("500"));
    const { result, unmount } = await renderHook(() => useSetPhotosLocationMutation());

    await act(async () => {
      defined(result.current).mutate({ selection: { image_hashes: ["h1"] }, lat: 1, lon: 2, overwrite: true });
    });
    await settle();

    expect(stubs.requestFailed).toHaveBeenCalledTimes(1);
    expect(stubs.photosLocationSet).not.toHaveBeenCalled();
    await unmount();
  });
});
