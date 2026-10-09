/**
 * The map reads initialViewState only when it mounts. A caller that keeps it
 * mounted while the user steps from one photo to the next, rather than
 * remounting it per photo, needs it to follow the new coordinates itself:
 * otherwise it kept showing the first photo's area with the new pin off-screen.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationMap } from "./LocationMap";

const stubs = vi.hoisted(() => ({ jumpTo: vi.fn(), mounts: 0 }));

vi.mock("../util/mapStyle", () => ({
  useMapStyle: () => ({ mapStyle: "https://example.invalid/style.json", mapsDisabled: false }),
}));

// Stands in for react-map-gl's <Map>: counts mounts and hands out a handle with jumpTo
vi.mock("react-map-gl/maplibre", async () => {
  const react = await import("react");
  const MapGL = react.forwardRef(function MapGL(props: any, ref: any) {
    react.useEffect(() => {
      stubs.mounts += 1;
    }, []);
    react.useImperativeHandle(ref, () => ({ jumpTo: stubs.jumpTo }), []);
    return react.createElement("div", { "data-testid": "map" }, props.children);
  });
  return {
    default: MapGL,
    Marker: () => null,
    Popup: () => null,
    NavigationControl: () => null,
    AttributionControl: () => null,
  };
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeAll(() => {
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
});

beforeEach(() => {
  stubs.jumpTo.mockReset();
  stubs.mounts = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

const photo = (image_hash: string, lat: number, lon: number) => ({ image_hash, exif_gps_lat: lat, exif_gps_lon: lon });

async function render(photos: unknown[]) {
  await act(async () => {
    root!.render(
      <MantineProvider>
        <LocationMap photos={photos} />
      </MantineProvider>
    );
  });
}

describe("LocationMap", () => {
  it("recentres the mounted map on the next photo's coordinates", async () => {
    await render([photo("a", 48.85, 2.35)]);
    await render([photo("b", 52.5, 13.4)]);

    expect(stubs.mounts).toBe(1);
    // At street level again, as a remounted map opened, whatever zoom the user left
    expect(stubs.jumpTo).toHaveBeenLastCalledWith({ center: [13.4, 52.5], zoom: 16, bearing: 0, pitch: 0 });
  });

  it("leaves the map where it is while the coordinates stay the same", async () => {
    await render([photo("a", 48.85, 2.35)]);
    stubs.jumpTo.mockClear();
    // The lightbox passes a new array on every render
    await render([photo("a", 48.85, 2.35)]);

    expect(stubs.jumpTo).not.toHaveBeenCalled();
  });
});
