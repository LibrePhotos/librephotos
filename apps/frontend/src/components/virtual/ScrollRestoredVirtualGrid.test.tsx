import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import React, { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TileGrid } from "./TileGrid";
import type { TileGridSizing } from "./TileGrid";

// Returning to an album list from an album (#377): the list scrolls its own element, which the
// router saves on the way out; the grid has to start there again when it remounts on Back.

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  // The router scrolls the window on every navigation; jsdom has no window.scrollTo
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

// The list's data: loaded (as from a warm query cache) or still loading
const list = (() => {
  let count = 1000;
  const listeners = new Set<() => void>();
  return {
    get: () => count,
    set: (next: number) => {
      count = next;
      listeners.forEach(listener => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

// Four columns of 160px rows in a 480px viewport
const sizing: TileGridSizing = {
  columnCount: 4,
  columnWidth: 100,
  cellPadding: 5,
  captionHeight: 60,
  height: 480,
  gutter: 5,
};

function AlbumList() {
  const count = useSyncExternalStore(list.subscribe, list.get);
  const items = Array.from({ length: count }, (_unused, id) => ({ id }));
  return (
    <TileGrid
      scrollRestorationId="test-albums"
      items={items}
      getKey={item => item.id}
      sizing={sizing}
      renderItem={item => <span data-tile={item.id} />}
    />
  );
}

function buildRouter() {
  const rootRoute = createRootRoute({ component: Outlet });
  const albums = createRoute({ getParentRoute: () => rootRoute, path: "/", component: AlbumList });
  const album = createRoute({ getParentRoute: () => rootRoute, path: "/album", component: () => <p>an album</p> });
  return createRouter({
    routeTree: rootRoute.addChildren([albums, album]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    scrollRestoration: true,
  });
}

const grid = () => {
  const element = container.querySelector('[data-scroll-restoration-id="test-albums"]');
  if (!(element instanceof HTMLElement)) throw new Error("the album list is not shown");
  return element;
};
const tileIds = () =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-tile]"), tile => Number(tile.dataset.tile));

async function openListScrolledTo(scrollTop: number) {
  const router = buildRouter();
  await act(async () => {
    root.render(<RouterProvider router={router} />);
  });
  await act(async () => {
    grid().scrollTop = scrollTop;
    grid().dispatchEvent(new Event("scroll"));
  });
  return router;
}

async function openAlbumAndGoBack(router: ReturnType<typeof buildRouter>) {
  await act(async () => {
    await router.navigate({ to: "/album" });
  });
  expect(container.textContent).toContain("an album");
  await act(async () => {
    router.history.back();
  });
}

describe("ScrollRestoredVirtualGrid", () => {
  it("comes back on Back where the list was left, the rows there rendered", async () => {
    list.set(1000);
    const router = await openListScrolledTo(8000);

    await openAlbumAndGoBack(router);

    expect(grid().scrollTop).toBe(8000);
    // Row 50 of four tiles each, not the top of the list
    expect(tileIds()).toContain(200);
    expect(tileIds()).not.toContain(0);
  });

  it("comes back there once a list that was still loading has its rows", async () => {
    list.set(1000);
    const router = await openListScrolledTo(8000);
    await act(async () => {
      list.set(0);
    });

    await openAlbumAndGoBack(router);
    // A browser clamps the position to the empty list (jsdom does not)
    grid().scrollTop = 0;
    await act(async () => {
      list.set(1000);
    });

    expect(grid().scrollTop).toBe(8000);
    expect(tileIds()).toContain(200);
  });

  it("starts at the top when the list is opened afresh", async () => {
    list.set(1000);
    await act(async () => {
      root.render(<RouterProvider router={buildRouter()} />);
    });

    expect(grid().scrollTop).toBe(0);
    expect(tileIds()).toContain(0);
  });
});
