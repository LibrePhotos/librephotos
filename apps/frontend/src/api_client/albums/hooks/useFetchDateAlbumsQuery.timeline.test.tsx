/**
 * The main timeline's filter (issue #2130) reaches the day list and day
 * requests as params, and is part of both query keys, so a cached page of one
 * filter is never shown (or merged) under another. A day's page finds its
 * cursor in the page before it or in the day's layout.
 */
import { photoGridKeys, Photoset } from "@librephotos/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";

const stubs = await vi.hoisted(async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    get: vi.fn<(endpoint: string) => Promise<unknown>>(),
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  };
});

vi.mock("../../api", async () => ({
  apiClient: { get: stubs.get },
  queryClient: stubs.queryClient,
  ApiError: (await vi.importActual<typeof import("../../apiError")>("../../apiError")).ApiError,
}));
const { ApiError } = await import("../../apiError");

const { dateAlbumsListKey, useFetchDateAlbumsQuery } = await import("./useFetchDateAlbumsQuery");
const { useFetchDateAlbumQuery } = await import("./useFetchDateAlbumQuery");

const filter = { media: "photos" as const, hide_screenshots: true, hide_documents: false, favorites: false };
const SECOND_PAGE_AFTER = "0b6c6f7e-2d64-4a55-9b1e-6d7f8e9a0b1c";
const GONE = "11111111-2222-4333-8444-555555555555";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function render(element: React.ReactElement) {
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<QueryClientProvider client={stubs.queryClient}>{element}</QueryClientProvider>);
  });
  // Let the query functions resolve.
  await act(async () => {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  });
}

describe("date-album queries with a timeline filter", () => {
  it("sends the filter and keys the list by it", async () => {
    stubs.get.mockResolvedValue({ results: [] });
    function List() {
      useFetchDateAlbumsQuery({ photosetType: Photoset.NONE, timelineFilter: filter });
      return null;
    }
    await render(<List />);

    const url = new URL(defined(stubs.get.mock.calls[0], "the request")[0], "http://x");
    expect(url.pathname).toBe("/days/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      archived: "false",
      media: "photos",
      hide_screenshots: "true",
    });
    const keys = stubs.queryClient
      .getQueryCache()
      .findAll({ queryKey: photoGridKeys.kind("dateAlbums") })
      .map(query => query.queryKey);
    expect(keys).toContainEqual([
      "photoGrid",
      "dateAlbums",
      Photoset.NONE,
      undefined,
      undefined,
      undefined,
      "all",
      "hide_screenshots=true&media=photos",
    ]);
  });

  it("reads a later page's cursor from the day's layout, with the same filter", async () => {
    stubs.queryClient.clear();
    stubs.get.mockReset();
    stubs.get.mockImplementation(async endpoint =>
      endpoint.includes("/layout/")
        ? { id: 1, numberOfItems: 150, aspectRatios: [], page_after: [null, SECOND_PAGE_AFTER] }
        : { items: [], next: null }
    );
    function Day() {
      useFetchDateAlbumQuery({ photosetType: Photoset.NONE, album_date_id: 1, page: 2, timelineFilter: filter });
      return null;
    }
    await render(<Day />);

    const [layout, photos] = stubs.get.mock.calls.map(([endpoint]) => new URL(endpoint, "http://x"));
    const filterParams = { archived: "false", media: "photos", hide_screenshots: "true" };
    // Slashed: without it Django answers every request with a 301.
    expect(defined(layout).pathname).toBe("/days/1/layout/");
    expect(Object.fromEntries(defined(layout).searchParams)).toEqual({ ...filterParams, limit: "100" });
    expect(defined(photos).pathname).toBe("/days/1/photos/");
    expect(Object.fromEntries(defined(photos).searchParams)).toEqual({
      ...filterParams,
      after: SECOND_PAGE_AFTER,
      limit: "100",
    });
  });

  it("continues from the page before without reading the layout", async () => {
    stubs.queryClient.clear();
    stubs.get.mockReset();
    stubs.get.mockResolvedValue({ items: [], next: null });
    const key = dateAlbumsListKey({ photosetType: Photoset.NONE });
    stubs.queryClient.setQueryData(photoGridKeys.dateAlbumDay(key, 1, 1), { items: [], next: SECOND_PAGE_AFTER });
    function Day() {
      useFetchDateAlbumQuery({ photosetType: Photoset.NONE, album_date_id: 1, page: 2 });
      return null;
    }
    await render(<Day />);

    expect(stubs.get).toHaveBeenCalledTimes(1);
    const url = new URL(defined(stubs.get.mock.calls[0], "the request")[0], "http://x");
    expect(url.pathname).toBe("/days/1/photos/");
    expect(url.searchParams.get("after")).toBe(SECOND_PAGE_AFTER);
  });

  it("looks a stale cursor up again in a fresh layout", async () => {
    stubs.queryClient.clear();
    stubs.get.mockReset();
    const key = dateAlbumsListKey({ photosetType: Photoset.NONE });
    stubs.queryClient.setQueryData(photoGridKeys.dateAlbumDay(key, 1, 1), { items: [], next: GONE });
    stubs.get.mockImplementation(async endpoint => {
      if (endpoint.includes("/layout/")) {
        return { id: 1, numberOfItems: 150, aspectRatios: [], page_after: [null, SECOND_PAGE_AFTER] };
      }
      if (endpoint.includes(GONE)) throw new ApiError("stale", 400);
      return { items: [], next: null };
    });
    function Day() {
      useFetchDateAlbumQuery({ photosetType: Photoset.NONE, album_date_id: 1, page: 2 });
      return null;
    }
    await render(<Day />);

    const paths = stubs.get.mock.calls.map(([endpoint]) => new URL(endpoint, "http://x"));
    expect(paths.map(url => url.pathname)).toEqual(["/days/1/photos/", "/days/1/layout/", "/days/1/photos/"]);
    expect(defined(paths[2]).searchParams.get("after")).toBe(SECOND_PAGE_AFTER);
  });

  it("reads nothing for a page past the end of the day", async () => {
    stubs.queryClient.clear();
    stubs.get.mockReset();
    const key = dateAlbumsListKey({ photosetType: Photoset.NONE });
    stubs.queryClient.setQueryData(photoGridKeys.dateAlbumDay(key, 1, 1), { items: [], next: null });
    function Day() {
      useFetchDateAlbumQuery({ photosetType: Photoset.NONE, album_date_id: 1, page: 2 });
      return null;
    }
    await render(<Day />);

    expect(stubs.get).not.toHaveBeenCalled();
  });

  it("fills a shared library's days only from that library's cached pages (#2731)", async () => {
    stubs.get.mockReset();
    stubs.get.mockResolvedValue({
      results: [{ id: 5, date: "2025-10-18", location: "", incomplete: true, numberOfItems: 1, items: [] }],
    });
    const page = (library: number, imageHash: string) => {
      const key = dateAlbumsListKey({ photosetType: Photoset.NONE, library });
      stubs.queryClient.setQueryData(photoGridKeys.dateAlbumDay(key, 5, 1), {
        items: [{ id: imageHash, image_hash: imageHash }],
        next: null,
      });
    };
    page(8, "theirs");
    page(7, "anna");
    function List() {
      useFetchDateAlbumsQuery({ photosetType: Photoset.NONE, library: 7 });
      return null;
    }
    await render(<List />);

    const url = new URL(defined(stubs.get.mock.calls[0], "the request")[0], "http://x");
    expect(url.searchParams.get("library")).toBe("7");
    const key = photoGridKeys.dateAlbumList(dateAlbumsListKey({ photosetType: Photoset.NONE, library: 7 }));
    const groups = stubs.queryClient.getQueryData<{ items: { image_hash: string }[] }[]>(key);
    expect(defined(groups?.[0]).items.map(item => item.image_hash)).toEqual(["anna"]);
  });

  it("does not fetch while skipped", async () => {
    stubs.get.mockReset();
    function List() {
      useFetchDateAlbumsQuery(
        { photosetType: Photoset.NONE, timelineFilter: { ...filter, favorites: true } },
        { skip: true }
      );
      return null;
    }
    await render(<List />);
    expect(stubs.get).not.toHaveBeenCalled();
  });
});
