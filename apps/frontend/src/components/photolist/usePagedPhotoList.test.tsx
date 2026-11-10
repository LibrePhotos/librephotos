/**
 * The paged photo lists (No timestamp, No location, Not in an album) read their flat list from the
 * answers of every page asked for, so a page skipped by a fast scroll is asked for, a refetched
 * page 1 keeps the pages after it, a count change does not shift photos, and a failed page is asked
 * again once it is back on screen.
 */
import type { PigPhoto } from "@librephotos/api-client";
import { photoGridKeys } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { usePhotoPages } from "../../api_client/photos/hooks/usePhotoPages";
import { defined } from "../../util/defined.test-utils";
import { tempPigPhoto } from "../../util/util";
import { layoutPages } from "./pagedPhotoList";
import { usePagedPhotoList, useRequestedPages } from "./usePagedPhotoList";

type Page = { count: number; results: PigPhoto[] };

const server = vi.hoisted(() => ({
  count: 250,
  /** Pages that fail until taken out again. */
  failing: new Set<number>(),
  fetch: vi.fn<(page: number) => void>(),
}));

const photo = (page: number, i: number, round = 0): PigPhoto => ({
  ...tempPigPhoto(`p${page}-${i}${round ? `r${round}` : ""}`),
  isTemp: false,
});

let round = 0;
async function answer(page: number): Promise<Page> {
  server.fetch(page);
  if (server.failing.has(page)) throw new Error("offline");
  const start = (page - 1) * 100;
  const size = Math.max(0, Math.min(100, server.count - start));
  return { count: server.count, results: Array.from({ length: size }, (_unused, i) => photo(page, i, round)) };
}

const pageQuery = (page: number) => ({
  queryKey: photoGridKeys.notInAlbum(page, "all"),
  queryFn: () => answer(page),
});

let latest: ReturnType<typeof usePagedPhotoList>;
function Harness() {
  const requested = useRequestedPages();
  latest = usePagedPhotoList(requested, usePhotoPages(requested.pages, pageQuery));
  return null;
}

let root: Root;
let client: QueryClient;
const settle = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
const ids = (from: number, to: number) => latest.photosFlat.slice(from, to).map(p => p.id);
const show = async (...indexes: number[]) => {
  await act(async () => latest.loadVisiblePage(indexes.map(i => tempPigPhoto(`temp-${i}`))));
  await settle();
};

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  server.count = 250;
  server.failing.clear();
  server.fetch.mockClear();
  round = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );
  });
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("a paged photo list", () => {
  it("asks for every page with a placeholder on screen, not only the first", async () => {
    await show(190, 210);

    expect(ids(199, 201)).toEqual(["p2-99", "p3-0"]);
    expect(server.fetch.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it("keeps the pages after page 1 when page 1 is asked again", async () => {
    await show(150);
    await act(async () => client.invalidateQueries({ queryKey: photoGridKeys.notInAlbum(1, "all"), exact: true }));
    await settle();

    expect(defined(latest.photosFlat[150]).id).toBe("p2-50");
  });

  it("holds a page answered for another count as placeholders until it is on screen again", async () => {
    await show(150);
    // A photo of page 1 was deleted: page 1 answers again with one photo less.
    server.count = 249;
    round = 1;
    await act(async () => client.invalidateQueries({ queryKey: photoGridKeys.notInAlbum(1, "all"), exact: true }));
    await settle();

    expect(latest.photosFlat).toHaveLength(249);
    expect(defined(latest.photosFlat[0]).id).toBe("p1-0r1");
    expect(defined(latest.photosFlat[150]).isTemp).toBe(true);

    await show(150);
    expect(defined(latest.photosFlat[150]).id).toBe("p2-50r1");
  });

  it("asks again for a failed page once it is reported on screen again", async () => {
    server.failing.add(2);
    await show(150);
    expect(defined(latest.photosFlat[150]).isTemp).toBe(true);

    server.failing.delete(2);
    await show(150);
    expect(defined(latest.photosFlat[150]).id).toBe("p2-50");
    expect(server.fetch.mock.calls.filter(([page]) => page === 2)).toHaveLength(2);
  });

  it("reports page 1's failure for the list's error state", async () => {
    await act(async () => root.unmount());
    server.failing.add(1);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>
      );
    });
    await settle();

    expect(latest.firstPage.isError).toBe(true);
    expect(latest.photosFlat).toEqual([]);
  });
});

describe("layoutPages", () => {
  const page = (count: number, results: PigPhoto[]) => ({ count, results });

  it("takes the count from the newest answer, whichever page it is", () => {
    const layout = layoutPages(
      [1, 2],
      [
        { data: page(250, [photo(1, 0)]), at: 1 },
        { data: page(260, [photo(2, 0)]), at: 2 },
      ]
    );

    expect(layout.photos).toHaveLength(260);
    expect(defined(layout.photos[100]).id).toBe("p2-0");
    expect(defined(layout.photos[0]).isTemp).toBe(true);
    expect([...layout.stale]).toEqual([1]);
  });

  it("never grows the list past its count", () => {
    const layout = layoutPages([2], [{ data: page(101, [photo(2, 0), photo(2, 1)]), at: 1 }]);

    expect(layout.photos).toHaveLength(101);
    expect(defined(layout.photos[100]).id).toBe("p2-0");
  });

  it("is empty before any page answered", () => {
    expect(layoutPages([1], [undefined]).photos).toEqual([]);
  });
});
