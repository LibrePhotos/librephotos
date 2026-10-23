/**
 * The public gallery's page (#434): a closed gallery (a 404) sends a visitor to the login page and
 * a user to their timeline, as /public did before. An open one lists the timeline, the towns, the
 * people (two photographers' "Mia" stay two, each with whose photos they are) and the
 * photographers, with chips that narrow everything to one photographer.
 */
import { ApiError } from "@librephotos/api-client";
import type { Gallery, GalleryPerson, GalleryPhotographer, GalleryPlace } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { GalleryPage } from "./GalleryPage";
import type { GallerySearch } from "./gallerySearch";

type Query<T> = { data: T | undefined; error: unknown; isLoading: boolean; isError: boolean; isPending: boolean };

function answer<T>(data: T | undefined, error: unknown = null): Query<T> {
  return { data, error, isLoading: false, isError: error !== null, isPending: data === undefined && !error };
}

const anna = { id: 2, username: "anna", first_name: "Anna", last_name: "Berger" };
const ben = { id: 3, username: "ben", first_name: "", last_name: "" };
const cover = { image_hash: "hash1", video: false };

const stubs = vi.hoisted(() => ({
  gallery: { data: undefined, error: null, isLoading: true, isError: false, isPending: true } as Query<Gallery>,
  signedIn: false,
  navigated: [] as Record<string, unknown>[],
  photographers: [] as GalleryPhotographer[],
  places: [] as GalleryPlace[],
  people: [] as GalleryPerson[],
  peopleOwners: [] as (number | undefined)[],
  timeline: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-router", () => ({
  Navigate: (props: Record<string, unknown>) => {
    stubs.navigated.push(props);
    return null;
  },
  // A search function gets the address it would change: photographer 2 and another town.
  Link: ({
    children,
    search,
    params,
  }: {
    children: React.ReactNode;
    search?: object | ((previous: { owner?: number; place?: string }) => object);
    params?: unknown;
  }) => (
    <a
      data-search={JSON.stringify(typeof search === "function" ? search({ owner: 2, place: "Old" }) : search)}
      data-params={JSON.stringify(params ?? null)}
    >
      {children}
    </a>
  ),
}));
vi.mock("../../api_client/auth", () => ({ useIsAuthenticatedQuery: () => ({ data: stubs.signedIn }) }));
vi.mock("../../api_client/gallery/hooks", () => ({
  useGalleryQuery: () => stubs.gallery,
  useGalleryPhotographersQuery: () => answer(stubs.photographers),
  useGalleryPlacesQuery: () => answer(stubs.places),
  useGalleryPeopleQuery: (owner: number | undefined) => {
    stubs.peopleOwners.push(owner);
    return answer(stubs.people);
  },
}));
vi.mock("./GalleryTimeline", () => ({
  GalleryTimeline: (props: Record<string, unknown>) => {
    stubs.timeline.push(props);
    return <div data-testid="timeline" />;
  },
}));
vi.mock("../Tile", () => ({ Tile: ({ image_hash }: { image_hash: string }) => <img data-tile={image_hash} alt="" /> }));
// The grid's virtualisation needs a layout jsdom lacks: every tile in a plain list.
vi.mock("../virtual/TileGrid", () => ({
  TileGrid: <T,>({
    items,
    getKey,
    renderItem,
    renderCaption,
  }: {
    items: T[];
    getKey: (item: T) => string | number;
    renderItem: (item: T, size: number) => React.ReactNode;
    renderCaption: (item: T) => React.ReactNode;
  }) => (
    <ul>
      {items.map(item => (
        <li key={getKey(item)} data-testid="tile">
          {renderItem(item, 100)}
          {renderCaption(item)}
        </li>
      ))}
    </ul>
  ),
}));

beforeAll(async () => {
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
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

let root: Root | undefined;
let container: HTMLDivElement;
const onSearch = vi.fn<(search: GallerySearch) => void>();

beforeEach(() => {
  stubs.gallery = answer<Gallery>({ stage: "everyone", indexable: false, photo_count: 4, photographer_count: 2 });
  stubs.signedIn = false;
  stubs.navigated = [];
  stubs.photographers = [
    { ...anna, photo_count: 3, cover_photos: [cover] },
    { ...ben, photo_count: 1, cover_photos: [] },
  ];
  stubs.places = [{ name: "Munich", photo_count: 3, owner_ids: [2, 99], cover_photos: [cover] }];
  stubs.people = [
    { id: 7, name: "Mia", owner: anna, photo_count: 1, face_url: "/media/faces/a.jpg" },
    { id: 8, name: "Mia", owner: ben, photo_count: 1, face_url: null },
  ];
  stubs.peopleOwners = [];
  stubs.timeline = [];
  onSearch.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  document.head.querySelectorAll("meta[name=robots]").forEach(meta => meta.remove());
});

async function render(search: GallerySearch = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <GalleryPage search={search} onSearch={onSearch} />
      </MantineProvider>
    )
  );
}

const robots = () => document.head.querySelector<HTMLMetaElement>("meta[name=robots]")?.content;

describe("the public gallery page", () => {
  it("sends a visitor to the login page while the gallery is closed", async () => {
    stubs.gallery = answer<Gallery>(undefined, new ApiError(404, "/gallery/", "Not found"));
    await render();
    expect(stubs.navigated).toEqual([expect.objectContaining({ to: "/login", replace: true })]);
  });

  it("sends a signed-in user to their timeline while the gallery is closed", async () => {
    stubs.signedIn = true;
    stubs.gallery = answer<Gallery>(undefined, new ApiError(404, "/gallery/", "Not found"));
    await render();
    expect(stubs.navigated).toEqual([expect.objectContaining({ to: "/", replace: true })]);
  });

  it("shows the counts and the timeline, and asks search engines to stay out", async () => {
    await render();
    expect(container.querySelector("h1")?.textContent).toBe("Public photos");
    expect(container.textContent).toContain("4 photos from 2 photographers");
    expect(container.querySelector("[data-testid=timeline]")).not.toBeNull();
    expect(stubs.timeline.at(-1)).toEqual({ filter: {}, filtered: false });
    expect(robots()).toBe("noindex, nofollow");
  });

  it("lets search engines in when the admin does, and says when only members see it", async () => {
    stubs.gallery = answer<Gallery>({ stage: "members", indexable: true, photo_count: 4, photographer_count: 2 });
    await render();
    expect(robots()).toBeUndefined();
    expect(container.textContent).toContain("Only signed-in users see this page for now");
  });

  it("narrows to one photographer with the chips", async () => {
    await render({ place: "Munich" });
    const chips = [...container.querySelectorAll<HTMLInputElement>("input[type=radio]")];
    expect(chips).toHaveLength(3);
    await act(async () => defined(chips[1]).click());
    expect(onSearch).toHaveBeenCalledWith({ place: "Munich", owner: 2, person: undefined });
  });

  it("shows the active town and person filters, each with a way to take it off", async () => {
    await render({ place: "Munich", person: 8, owner: 3 });
    expect(stubs.timeline.at(-1)).toEqual({ filter: { owner: 3, place: "Munich", person: 8 }, filtered: true });
    expect(stubs.peopleOwners).toContain(3);
    const remove = defined(container.querySelector<HTMLButtonElement>("button[aria-label='Remove filter Mia']"));
    await act(async () => remove.click());
    expect(onSearch).toHaveBeenCalledWith({ place: "Munich", person: undefined, owner: 3 });
    expect(container.textContent).toContain("Taken in Munich");
  });

  it("lists towns with the photographers who took them, linking to the timeline", async () => {
    await render({ tab: "places", owner: 2 });
    const tile = defined(container.querySelector("[data-testid=tile]"));
    expect(tile.textContent).toContain("Munich");
    expect(tile.textContent).toContain("3 Photos");
    expect(tile.querySelector("[aria-label='Anna Berger']")).not.toBeNull();
    expect(tile.querySelector("a")?.dataset.search).toBe(JSON.stringify({ owner: 2, place: "Munich" }));
  });

  it("keeps two photographers' people of the same name apart", async () => {
    await render({ tab: "people" });
    const tiles = [...container.querySelectorAll("[data-testid=tile]")];
    expect(tiles.map(tile => tile.textContent)).toEqual([
      expect.stringContaining("named by Anna Berger"),
      expect.stringContaining("named by ben"),
    ]);
    expect(tiles[1]?.querySelector("a")?.dataset.search).toBe(JSON.stringify({ owner: 3, person: 8 }));
  });

  it("lists the photographers, each opening their photos on the timeline", async () => {
    await render({ tab: "photographers" });
    const links = [...container.querySelectorAll("[data-testid=tile] a")];
    expect(links[0]?.getAttribute("data-search")).toBe(JSON.stringify({ owner: 2 }));
    expect(container.querySelectorAll("input[type=radio]")).toHaveLength(0);
  });

  it("switches tabs keeping only the photographer filter", async () => {
    await render({ owner: 2, place: "Munich" });
    const tab = defined([...container.querySelectorAll<HTMLButtonElement>("[role=tab]")].at(1));
    await act(async () => tab.click());
    expect(onSearch).toHaveBeenCalledWith({ owner: 2, tab: "places" });
  });

  it("says so when nobody takes part yet", async () => {
    stubs.photographers = [];
    stubs.places = [];
    stubs.people = [];
    for (const tab of ["places", "people", "photographers"] as const) {
      await render({ tab });
      expect(container.textContent).toMatch(/No places to show|No people to show|Nobody shows photos here yet/);
      await act(async () => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = document.createElement("div");
  });
});
