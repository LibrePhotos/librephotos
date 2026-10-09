/**
 * The main timeline's filter (issue #2130) reaches the date-album list and
 * day requests as params, and is part of both query keys, so a cached page of
 * one filter is never shown (or merged) under another.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Photoset } from "../../photos/types";

const stubs = await vi.hoisted(async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    get: vi.fn<(endpoint: string) => Promise<unknown>>(),
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  };
});

vi.mock("../../api", () => ({ fetchClient: { get: stubs.get }, queryClient: stubs.queryClient }));

const { useFetchDateAlbumsQuery } = await import("./useFetchDateAlbumsQuery");
const { useFetchDateAlbumQuery } = await import("./useFetchDateAlbumQuery");

const filter = { media: "photos" as const, hide_screenshots: true, hide_documents: false, favorites: false };

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

    const url = new URL(stubs.get.mock.calls[0][0], "http://x");
    expect(url.pathname).toBe("/albums/date/list/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ media: "photos", hide_screenshots: "true" });
    const keys = stubs.queryClient
      .getQueryCache()
      .findAll({ queryKey: ["dateAlbums"] })
      .map(query => query.queryKey);
    expect(keys).toContainEqual([
      "dateAlbums",
      Photoset.NONE,
      undefined,
      undefined,
      undefined,
      "all",
      "hide_screenshots=true&media=photos",
    ]);
  });

  it("sends the same filter for a day's page", async () => {
    stubs.get.mockReset();
    stubs.get.mockResolvedValue({ results: { id: "1", date: null, location: null, items: [], numberOfItems: 0 } });
    function Day() {
      useFetchDateAlbumQuery({ photosetType: Photoset.NONE, album_date_id: "1", page: 2, timelineFilter: filter });
      return null;
    }
    await render(<Day />);

    const url = new URL(stubs.get.mock.calls[0][0], "http://x");
    // Slashed: without it Django answers every day page with a 301.
    expect(url.pathname).toBe("/albums/date/1/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ media: "photos", hide_screenshots: "true", page: "2" });
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
