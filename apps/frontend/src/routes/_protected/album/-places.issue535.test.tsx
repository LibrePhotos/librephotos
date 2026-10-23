/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/535
 *
 *   "Places do not show up on first load / click"
 *   -> "As soon as I scroll around the map, the places are shown to me at the bottom."
 *
 * The Places page keeps the album list in `visibleAlbums`, and the only thing that ever
 * writes to it is `updateVisibleAlbums(map)`, which needs a live MapLibre instance to
 * read `map.getBounds()` from. Every caller is gated on `mapRef.current`:
 *
 *   - the mount effect bails out, because react-map-gl creates its map inside a promise
 *     and the imperative handle is still null while the parent's effects run,
 *   - `onLoad` only arrives once the style/tiles have actually loaded,
 *   - `onMoveEnd` needs the user to pan or zoom.
 *
 * So the list starts out empty and stays empty until the map says something, and when
 * the admin sets the map tile provider to "None" no map is rendered at all, which leaves
 * the page permanently showing "Showing 0 places" underneath.
 *
 * Both tests below render the real page with both queries already resolved and assert
 * that the places are on screen on first mount.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { STORAGE_KEYS } from "../../../util/storage";
// Imported statically, like every other test's subject: loading the route's
// module graph then happens while the file is collected, which has no time
// limit. Under a parallel run on a busy machine it can take many seconds, and
// in a beforeAll it kept hitting the hook timeout. The vi.mock() calls below
// are hoisted above this import, and running the module hands its page
// component to the createFileRoute stub.
import "./places.index";

/**
 * The route stub: createFileRoute("...")(options) and its chained calls hand back the same
 * function, which also answers the page's search params (none: no place to edit).
 */
type RouteStub = ((options?: { component?: React.ComponentType }) => RouteStub) & { useSearch: () => object };

/** The part of a MapLibre map the page reads. */
type MapStub = {
  getBounds: () => { getSouth: () => number; getWest: () => number; getNorth: () => number; getEast: () => number };
  queryRenderedFeatures: () => never[];
  getSource: () => null;
};

const stubs = vi.hoisted(() => ({
  component: null as React.ComponentType | null,
  // As /photos/map-points/ returns them: [lat, lon, photos]
  mapPoints: {
    points: [
      [48.85, 2.35, 12],
      [52.5, 13.4, 3],
    ],
    photo_count: 15,
  },
  // The place albums with a photo in the map's view; undefined until the map reports one
  placesInView: undefined as number[] | undefined,
  // The user's own places (#1365)
  userPlaces: [] as {
    id: number;
    name: string;
    icon: "home";
    center_lat: number;
    center_lon: number;
    radius_m: number;
    use_in_titles: boolean;
    photo_count: number;
    cover_photos: never[];
  }[],
  albums: [
    { id: 1, title: "Paris", cover_photos: [{ image_hash: "hash1" }], photo_count: 12, geolocation_level: 2 },
    { id: 2, title: "Berlin", cover_photos: [{ image_hash: "hash2" }], photo_count: 3, geolocation_level: 2 },
  ] as {
    id: number;
    title: string;
    cover_photos: { image_hash: string }[];
    photo_count: number;
    geolocation_level: number;
  }[],
  mapStyle: { mapStyle: "https://example.invalid/style.json", mapsDisabled: false } as {
    mapStyle: unknown;
    mapsDisabled: boolean;
  },
  // A background refetch: the data is there and the queries are fetching again
  fetching: false,
  // The first load, before any answer
  loading: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route: RouteStub = Object.assign(
      (options?: { component?: React.ComponentType }) => {
        stubs.component = options?.component ?? null;
        return route;
      },
      { useSearch: () => ({}) }
    );
    return route;
  },
  useNavigate: () => () => Promise.resolve(),
  // The href the real Link builds from `to` and `params`
  Link: ({ children, to, params }: { children?: React.ReactNode; to: string; params?: { id: string } }) => (
    <a href={to.replace("$id", params?.id ?? "")}>{children}</a>
  ),
  // No saved scroll position: the grid starts at the top
  useElementScrollRestoration: () => undefined,
}));
vi.mock("../../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchPlacesAlbumsQuery: () => ({ data: stubs.albums, isFetching: stubs.fetching, isLoading: stubs.loading }),
  useFetchPhotoMapPointsQuery: () => ({ data: stubs.mapPoints, isFetching: stubs.fetching, isLoading: false }),
  usePlaceAlbumsInBoundsQuery: () => ({ data: stubs.placesInView }),
  usePhotosInBoundsQuery: () => ({ data: undefined, isError: false, isFetching: false, refetch: () => {} }),
  useUserPlacesQuery: () => ({ data: stubs.userPlaces }),
}));
vi.mock("../../../util/mapStyle", () => ({ useMapStyle: () => stubs.mapStyle }));
// The lightbox and its routes are not what this page test is about
vi.mock("../../../components/map/SpotLightbox", () => ({ SpotLightbox: () => null }));

/**
 * Stands in for react-map-gl's <Map>. It reproduces the two things that matter here:
 * the map instance only exists after a promise resolves (so the imperative handle is
 * null while the parent mounts), and `onLoad` is not fired, which is what happens when
 * the style or the tile server cannot be reached.
 */
vi.mock("react-map-gl/maplibre", async () => {
  const react = await import("react");
  const MapGL = react.forwardRef<MapStub | null, { children?: React.ReactNode }>(function MapGL(props, ref) {
    const [map, setMap] = react.useState<MapStub | null>(null);
    react.useEffect(() => {
      let mounted = true;
      void Promise.resolve().then(() => {
        if (!mounted) return;
        setMap({
          getBounds: () => ({ getSouth: () => 40, getWest: () => -10, getNorth: () => 60, getEast: () => 30 }),
          queryRenderedFeatures: () => [],
          getSource: () => null,
        });
      });
      return () => {
        mounted = false;
      };
    }, []);
    react.useImperativeHandle<MapStub | null, MapStub | null>(ref, () => map, [map]);
    return react.createElement("div", { "data-testid": "map" }, map ? props.children : null);
  });
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    react.createElement(react.Fragment, null, children);
  return {
    default: MapGL,
    Source: passthrough,
    Layer: () => null,
    Marker: passthrough,
    NavigationControl: () => null,
    AttributionControl: () => null,
  };
});

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
  // The your-places row scrolls sideways (ScrollArea); jsdom has no ResizeObserver
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

const ALBUMS = [...stubs.albums];

beforeEach(() => {
  stubs.albums = [...ALBUMS];
  stubs.mapStyle = { mapStyle: "https://example.invalid/style.json", mapsDisabled: false };
  stubs.fetching = false;
  stubs.loading = false;
  stubs.placesInView = undefined;
  stubs.userPlaces = [];
  localStorage.clear();
});

async function renderPage() {
  const AlbumPlace = stubs.component;
  if (!AlbumPlace) throw new Error("the route did not register its component");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <AlbumPlace />
      </MantineProvider>
    );
  });
  return {
    container,
    links: (href: string) => Array.from(container.querySelectorAll(`a[href="${href}"]`)),
    // Each place card titles its (clamped) name with the full one
    titles: () => Array.from(container.querySelectorAll("p[title]")).map(el => el.getAttribute("title")),
    subtitle: () => container.textContent ?? "",
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("the places page on first mount", () => {
  it("lists the place albums without waiting for the map to move", async () => {
    const page = await renderPage();

    expect(page.titles()).toEqual(expect.arrayContaining(["Paris", "Berlin"]));
    // The map counts photos, the grid places (#343)
    expect(page.subtitle()).toContain("15 photos on the map · 2 places in view");
    await page.unmount();
  });

  // #343: a place shows up under the map when one of its photos is in view, wherever its centre is
  it("lists only the places with a photo in the map's view once the map reports one", async () => {
    stubs.placesInView = [2];
    const page = await renderPage();

    expect(page.titles()).toEqual(["Berlin"]);
    expect(page.subtitle()).toContain("1 place in view");
    await page.unmount();
  });

  // #1365: your places above the places in view, whatever the map shows
  it("lists your places above the places in view", async () => {
    stubs.userPlaces = [
      {
        id: 7,
        name: "Home",
        icon: "home",
        center_lat: 48.1,
        center_lon: 11.5,
        radius_m: 150,
        use_in_titles: true,
        photo_count: 4,
        cover_photos: [],
      },
    ];
    const page = await renderPage();

    const text = page.subtitle();
    expect(text).toContain("Your places");
    expect(text).toContain("4 photos · 150 m");
    expect(text.indexOf("Your places")).toBeLessThan(text.indexOf("Places in view"));
    await page.unmount();
  });

  it("has a grip that makes the map taller, and remembers it", async () => {
    const page = await renderPage();
    const grip = page.container.querySelector<HTMLElement>('[role="separator"]');
    expect(grip?.getAttribute("aria-valuenow")).toBe("240");

    await act(async () => {
      grip?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    expect(grip?.getAttribute("aria-valuenow")).toBe("260");
    expect(localStorage.getItem(STORAGE_KEYS.placesMapHeight)).toBe("260");
    await page.unmount();
  });

  it("keeps the map and the places on screen while refetching in the background", async () => {
    stubs.fetching = true;
    const page = await renderPage();

    // Unmounting the map here threw away the user's pan and zoom
    expect(page.container.querySelector('[data-testid="map"]')).not.toBeNull();
    expect(page.titles()).toEqual(expect.arrayContaining(["Paris", "Berlin"]));
    await page.unmount();
  });

  it("lists the place with the most photos first", async () => {
    const page = await renderPage();

    expect(page.titles()).toEqual(["Paris", "Berlin"]);
    await page.unmount();
  });

  it("lists the place albums when map display is turned off", async () => {
    stubs.mapStyle = { mapStyle: null, mapsDisabled: true };
    const page = await renderPage();

    expect(page.titles()).toEqual(expect.arrayContaining(["Paris", "Berlin"]));
    // There is no map, and the count is every place
    expect(page.subtitle()).toContain("2 places");
    expect(page.subtitle()).not.toContain("on the map");
    await page.unmount();
  });
});

// #2234: the tile linked to its album only through the cover, and a place
// without one rendered no link at all.
describe("a place without a cover photo", () => {
  it("still opens from its tile and its title", async () => {
    stubs.albums = [{ id: 1, title: "Paris", cover_photos: [], photo_count: 12, geolocation_level: 2 }];
    const page = await renderPage();

    const links = page.links("/album/places/1");
    expect(links).toHaveLength(2);
    expect(links.some(link => link.textContent?.includes("Paris"))).toBe(true);
    await page.unmount();
  });
});

// #620: the places can be sorted, and the page keeps the order the user picked.
describe("sorting the places", () => {
  it("offers a sort menu that names the default order", async () => {
    const page = await renderPage();

    const button = page.container.querySelector('button[aria-label^="Sort:"]');
    expect(button?.getAttribute("aria-label")).toBe("Sort: Size of place, Largest first");
    await page.unmount();
  });

  it("lists the places in the stored order from the first render", async () => {
    localStorage.setItem(STORAGE_KEYS.albumSortPlaces, JSON.stringify({ key: "name", direction: "asc" }));
    const page = await renderPage();

    expect(page.titles()).toEqual(["Berlin", "Paris"]);
    await page.unmount();
  });

  it("shows the empty state and no sort menu without places", async () => {
    stubs.albums = [];
    const page = await renderPage();

    expect(page.subtitle()).toContain(i18n.t("emptystate.places.title"));
    expect(page.container.querySelector('button[aria-label^="Sort:"]')).toBeNull();
    await page.unmount();
  });

  it("shows the loader on the first load", async () => {
    stubs.loading = true;
    const page = await renderPage();

    expect(page.subtitle()).toContain(i18n.t("placealbum.maploading"));
    expect(page.titles()).toEqual([]);
    await page.unmount();
  });
});
