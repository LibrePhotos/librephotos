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

const stubs = vi.hoisted(() => ({
  component: null as React.ComponentType<any> | null,
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
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route = () => route;
    route.update = (options: any) => {
      stubs.component = options.component;
    };
    return route;
  },
  useNavigate: () => () => {},
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../api_client/albums/hooks", () => ({
  useFetchPlacesAlbumsQuery: () => ({ data: stubs.albums, isFetching: false }),
  useFetchLocationClustersQuery: () => ({ data: stubs.locationClusters, isFetching: false }),
}));
vi.mock("../util/mapStyle", () => ({ useMapStyle: () => stubs.mapStyle }));
// AutoSizer measures a real layout; jsdom reports 0 and the grid would render nothing.
vi.mock("react-virtualized", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AutoSizer: ({ children }: any) => children({ width: 1000, height: 600 }),
  };
});

/**
 * Stands in for react-map-gl's <Map>. It reproduces the two things that matter here:
 * the map instance only exists after a promise resolves (so the imperative handle is
 * null while the parent mounts), and `onLoad` is not fired, which is what happens when
 * the style or the tile server cannot be reached.
 */
vi.mock("react-map-gl/maplibre", async () => {
  const react = await import("react");
  const MapGL = react.forwardRef(function MapGL(props: any, ref: any) {
    const [map, setMap] = react.useState<any>(null);
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
    react.useImperativeHandle(ref, () => map, [map]);
    return react.createElement("div", { "data-testid": "map" }, map ? props.children : null);
  });
  const passthrough = ({ children }: any) => react.createElement(react.Fragment, null, children);
  return {
    default: MapGL,
    Source: passthrough,
    Layer: () => null,
    NavigationControl: () => null,
    AttributionControl: () => null,
  };
});

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.mapStyle = { mapStyle: "https://example.invalid/style.json", mapsDisabled: false };
});

async function renderPage() {
  await import("../routes/_protected/album/places.index");
  const AlbumPlace = stubs.component!;
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
    titles: () => Array.from(container.querySelectorAll("b")).map(el => el.textContent),
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

  it("lists the place albums when map display is turned off", async () => {
    stubs.mapStyle = { mapStyle: null, mapsDisabled: true };
    const page = await renderPage();

    expect(page.titles()).toEqual(expect.arrayContaining(["Paris", "Berlin"]));
    await page.unmount();
  });
});
