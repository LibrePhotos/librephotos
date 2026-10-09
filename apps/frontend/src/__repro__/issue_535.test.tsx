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
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
// Imported statically, like every other test's subject: loading the route's
// module graph then happens while the file is collected, which has no time
// limit. Under a parallel run on a busy machine it can take many seconds, and
// in a beforeAll it kept hitting the hook timeout. The vi.mock() calls below
// are hoisted above this import, and running the module hands its page
// component to the createFileRoute stub.
import "../routes/_protected/album/places.index";

/** The route stub: createFileRoute("...")(options) and its chained calls hand back the same function. */
type RouteStub = (options?: { component?: React.ComponentType }) => RouteStub;

/** The part of a MapLibre map the page reads. */
type MapStub = {
  getBounds: () => {
    getNorthEast: () => { lat: number; lng: number };
    getSouthWest: () => { lat: number; lng: number };
  };
  queryRenderedFeatures: () => never[];
  getSource: () => null;
};

const stubs = vi.hoisted(() => ({
  component: null as React.ComponentType | null,
  // [longitude, latitude, name], as /locclust/ returns it.
  locationClusters: [
    [2.35, 48.85, "Paris"],
    [13.4, 52.5, "Berlin"],
  ] as unknown[][],
  albums: [
    { id: 1, title: "Paris", cover_photos: [{ image_hash: "hash1" }], photo_count: 12, geolocation_level: 2 },
    { id: 2, title: "Berlin", cover_photos: [{ image_hash: "hash2" }], photo_count: 3, geolocation_level: 2 },
  ],
  mapStyle: { mapStyle: "https://example.invalid/style.json", mapsDisabled: false } as {
    mapStyle: unknown;
    mapsDisabled: boolean;
  },
  // A background refetch: the data is there and the queries are fetching again
  fetching: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route: RouteStub = options => {
      stubs.component = options?.component ?? null;
      return route;
    };
    return route;
  },
  useNavigate: () => () => {},
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../api_client/albums/hooks", () => ({
  useFetchPlacesAlbumsQuery: () => ({ data: stubs.albums, isFetching: stubs.fetching, isLoading: false }),
  useFetchLocationClustersQuery: () => ({ data: stubs.locationClusters, isFetching: stubs.fetching, isLoading: false }),
}));
vi.mock("../util/mapStyle", () => ({ useMapStyle: () => stubs.mapStyle }));

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
      Promise.resolve().then(() => {
        if (!mounted) return;
        setMap({
          getBounds: () => ({
            getNorthEast: () => ({ lat: 60, lng: 30 }),
            getSouthWest: () => ({ lat: 40, lng: -10 }),
          }),
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.mapStyle = { mapStyle: "https://example.invalid/style.json", mapsDisabled: false };
  stubs.fetching = false;
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
    expect(page.subtitle()).toContain("Showing 2 places on the map");
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
