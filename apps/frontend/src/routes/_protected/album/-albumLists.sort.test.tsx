/**
 * #620: the album lists are sorted in the order the user picked, read from storage before the
 * first render, and the sort button is in the header only while there is something to sort.
 * Events, People and Tags here; My Albums, Things and Places have their own page tests.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { STORAGE_KEYS } from "../../../util/storage";
import type { StorageKey } from "../../../util/storage";
// Imported statically so the module graph loads while the file is collected (see
// -places.issue535.test.tsx); each hands its page component to the createFileRoute stub.
import "./events.index";
import "./persons.index";
import "./tags.index";

/** The route stub: createFileRoute(path)(options) and its chained calls hand back the same function. */
type RouteStub = (options?: { component?: React.ComponentType }) => RouteStub;

const stubs = vi.hoisted(() => ({
  pages: new Map<string, React.ComponentType>(),
  events: [
    {
      id: 1,
      title: "Beach day",
      timestamp: "2020-06-01T00:00:00Z",
      start: "2020-06-01T10:00:00Z",
      photos: { image_hash: "e1", video: false },
      photo_count: 4,
      favorited: false,
    },
    {
      id: 2,
      title: "Alps trip",
      timestamp: "2023-02-01T00:00:00Z",
      start: "2023-02-01T10:00:00Z",
      photos: { image_hash: "e2", video: false },
      photo_count: 9,
      favorited: false,
    },
  ] as unknown[],
  people: [
    { id: "1", name: "Anna", video: false, face_count: 3, face_photo_url: "p1", face_url: "" },
    { id: "2", name: "Ben", video: false, face_count: 50, face_photo_url: "p2", face_url: "" },
  ] as unknown[],
  tags: [
    { id: 1, name: "beach", photo_count: 2, cover_photos: [{ image_hash: "t1", video: false }] },
    { id: 2, name: "mountain", photo_count: 8, cover_photos: [] },
  ] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => {
    const route: RouteStub = options => {
      if (options?.component) stubs.pages.set(path, options.component);
      return route;
    };
    return route;
  },
  useNavigate: () => () => {},
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  // No saved scroll position: the grid starts at the top
  useElementScrollRestoration: () => undefined,
}));
vi.mock("../../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchAutoAlbumsQuery: () => ({ data: stubs.events, isFetching: false }),
  useDeleteAutoAlbumMutation: () => ({ mutate: () => {} }),
  useFetchPeopleAlbumsQuery: () => ({ data: stubs.people, isFetching: false }),
  useRenamePersonAlbumMutation: () => ({ mutate: () => {} }),
  useDeletePersonAlbumMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../../api_client/jobs/hooks", () => ({
  useGenerateAutoAlbumsMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../../api_client/tags/hooks", () => ({
  useFetchTagsQuery: () => ({ data: stubs.tags, isFetching: false }),
  useRenameTagMutation: () => ({ mutate: () => {} }),
  useDeleteTagMutation: () => ({ mutate: () => {} }),
  useMergeTagsMutation: () => ({ mutate: () => {} }),
}));

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  localStorage.clear();
});

async function renderPage(path: string) {
  const Page = stubs.pages.get(path);
  if (!Page) throw new Error(`${path} did not register its component`);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <Page />
      </MantineProvider>
    );
  });
  return {
    // Each card titles its (clamped) name with the full one
    titles: () => Array.from(container.querySelectorAll("p[title]")).map(element => element.getAttribute("title")),
    sortLabel: () => container.querySelector('button[aria-label^="Sort:"]')?.getAttribute("aria-label"),
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function storeSort(key: StorageKey, sort: Readonly<{ key: string; direction: string }>) {
  localStorage.setItem(key, JSON.stringify(sort));
}

describe("Events", () => {
  const path = "/_protected/album/events/";

  it("are newest first by default", async () => {
    const page = await renderPage(path);
    expect(page.titles()).toEqual(["Alps trip", "Beach day"]);
    expect(page.sortLabel()).toBe("Sort: Date taken, Newest first");
    await page.unmount();
  });

  it("follow the stored order", async () => {
    storeSort(STORAGE_KEYS.albumSortEvents, { key: "name", direction: "desc" });
    const page = await renderPage(path);
    expect(page.titles()).toEqual(["Beach day", "Alps trip"]);
    await page.unmount();
  });
});

describe("People", () => {
  const path = "/_protected/album/persons/";

  it("are by name by default", async () => {
    const page = await renderPage(path);
    expect(page.titles()).toEqual(["Anna", "Ben"]);
    expect(page.sortLabel()).toBe("Sort: Name, A to Z");
    await page.unmount();
  });

  it("can be sorted by their number of faces", async () => {
    storeSort(STORAGE_KEYS.albumSortPeople, { key: "count", direction: "desc" });
    const page = await renderPage(path);
    expect(page.titles()).toEqual(["Ben", "Anna"]);
    expect(page.sortLabel()).toBe("Sort: Number of faces, Most first");
    await page.unmount();
  });
});

describe("Tags", () => {
  const path = "/_protected/album/tags/";

  it("are by name by default", async () => {
    const page = await renderPage(path);
    expect(page.titles()).toEqual(["beach", "mountain"]);
    await page.unmount();
  });

  it("can be sorted by their number of photos", async () => {
    storeSort(STORAGE_KEYS.albumSortTags, { key: "count", direction: "desc" });
    const page = await renderPage(path);
    expect(page.titles()).toEqual(["mountain", "beach"]);
    await page.unmount();
  });

  it("have no sort button without tags", async () => {
    const tags = stubs.tags;
    stubs.tags = [];
    const page = await renderPage(path);
    expect(page.sortLabel()).toBeUndefined();
    await page.unmount();
    stubs.tags = tags;
  });
});
