/**
 * Recently added, No timestamp, No location and Not in an album take the page's media filter (#2216): each filter is its
 * own cache entry, and the request carries the filter's flag.
 */
import { photoGridKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(endpoint =>
    Promise.resolve(
      endpoint.startsWith("/photos/recentlyadded/")
        ? { date: null, results: [] }
        : { count: 0, next: null, previous: null, results: [] }
    )
  ),
}));

vi.mock("../../api", () => ({ apiClient: { get: stubs.get } }));

const { useFetchRecentlyAddedPhotosQuery } = await import("./useFetchRecentlyAddedPhotosQuery");
const { useFetchPhotosWithoutTimestampQuery } = await import("./useFetchPhotosWithoutTimestampQuery");
const { useFetchPhotosWithoutLocationQuery } = await import("./useFetchPhotosWithoutLocationQuery");
const { useFetchPhotosNotInAlbumQuery } = await import("./useFetchPhotosNotInAlbumQuery");

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function renderHook(hook: () => unknown) {
  const client = new QueryClient();
  function Probe() {
    hook();
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
  await act(async () => root.unmount());
  return client;
}

describe("the media-filtered photo lists", () => {
  it("keys Recently added by the media filter and asks for it", async () => {
    const client = await renderHook(() => useFetchRecentlyAddedPhotosQuery("videos"));

    expect(client.getQueryData(photoGridKeys.recentlyAddedView("videos"))).toEqual({ date: null, results: [] });
    expect(client.getQueryData(photoGridKeys.recentlyAddedView("all"))).toBeUndefined();
    expect(stubs.get).toHaveBeenLastCalledWith("/photos/recentlyadded/?video=true");
  });

  it("asks Recently added for everything by default", async () => {
    const client = await renderHook(() => useFetchRecentlyAddedPhotosQuery());

    expect(client.getQueryData(photoGridKeys.recentlyAddedView("all"))).toBeDefined();
    expect(stubs.get).toHaveBeenLastCalledWith("/photos/recentlyadded/");
  });

  it("keys a No timestamp page by the media filter and asks for it", async () => {
    const client = await renderHook(() => useFetchPhotosWithoutTimestampQuery(3, "documents"));

    expect(client.getQueryData(photoGridKeys.withoutTimestamp(3, "documents"))).toBeDefined();
    expect(stubs.get).toHaveBeenLastCalledWith("/photos/notimestamp/?page=3&is_document=true");
  });

  it("keys a No location page by the media filter and asks for it", async () => {
    const client = await renderHook(() => useFetchPhotosWithoutLocationQuery(2, "screenshots"));

    expect(client.getQueryData(photoGridKeys.withoutLocation(2, "screenshots"))).toBeDefined();
    expect(client.getQueryData(photoGridKeys.withoutLocation(2, "all"))).toBeUndefined();
    expect(stubs.get).toHaveBeenLastCalledWith("/photos/nolocation/?page=2&is_screenshot=true");
  });

  it("keys a Not in an album page by the media filter and asks for it", async () => {
    const client = await renderHook(() => useFetchPhotosNotInAlbumQuery(2, "videos"));

    expect(client.getQueryData(photoGridKeys.notInAlbum(2, "videos"))).toBeDefined();
    expect(client.getQueryData(photoGridKeys.notInAlbum(2, "all"))).toBeUndefined();
    expect(stubs.get).toHaveBeenLastCalledWith("/photos/no-album/?page=2&video=true");
  });

  it("asks Not in an album for everything by default", async () => {
    await renderHook(() => useFetchPhotosNotInAlbumQuery(1));

    expect(stubs.get).toHaveBeenLastCalledWith("/photos/no-album/?page=1");
  });
});
