/**
 * A photo without a location opens the picker on a rough "near you" view. That pan happens
 * once, when the picker opens: picking a spot must not set it off again and pull the map
 * away from the pick, and a photo that already has a location keeps its own view.
 */
import { MantineProvider } from "@mantine/core";
import type { FlyToOptions } from "maplibre-gl";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { LocationPickerModal } from "./LocationPickerModal";

const stubs = vi.hoisted(() => ({ flyTo: vi.fn<(options: FlyToOptions) => void>() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock("../../util/mapStyle", () => ({
  useMapStyle: () => ({ mapStyle: "https://example.invalid/style.json", mapsDisabled: false }),
}));
vi.mock("./mapImages", () => ({ ignoreMissingStyleImages: () => {} }));
vi.mock("../../api_client/geocode", () => ({
  useGeocodeSearchQuery: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("../../api_client/photos/hooks/useUpdatePhotoMutation", () => ({
  useUpdatePhotoMutation: () => ({ mutateAsync: () => Promise.resolve(), isPending: false }),
}));
vi.mock("../../api_client/albums/invalidatePlaces", () => ({ invalidatePlaces: () => {} }));

// Stands in for react-map-gl's <Map>: a click on it picks a fixed spot, and its handle flies.
vi.mock("react-map-gl/maplibre", async () => {
  const react = await import("react");
  type ClickEvent = { lngLat: { lat: number; lng: number } };
  const MapGL = react.forwardRef(function MapGL(
    props: { children?: React.ReactNode; onClick?: (event: ClickEvent) => void },
    ref: React.ForwardedRef<{ flyTo: typeof stubs.flyTo }>
  ) {
    react.useImperativeHandle(ref, () => ({ flyTo: stubs.flyTo }), []);
    return react.createElement(
      "div",
      null,
      react.createElement("button", {
        type: "button",
        "data-testid": "map",
        onClick: () => props.onClick?.({ lngLat: { lat: 38.72, lng: -9.14 } }),
      }),
      props.children
    );
  });
  return {
    default: MapGL,
    Marker: () => null,
    NavigationControl: () => null,
    AttributionControl: () => null,
  };
});

const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>();

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
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
});

beforeEach(() => {
  stubs.flyTo.mockReset();
  getCurrentPosition.mockReset();
  // jsdom has no geolocation
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition, watchPosition: () => 0, clearWatch: () => {} },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, "geolocation");
});

function render(props: { initialLat?: number; initialLon?: number } = {}) {
  act(() => {
    root.render(
      <MantineProvider>
        <LocationPickerModal imageHash="abc" onClose={() => {}} {...props} />
      </MantineProvider>
    );
  });
}

function positionAt(latitude: number, longitude: number): GeolocationPosition {
  const coords = {
    latitude,
    longitude,
    accuracy: 1000,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  };
  return { coords: { ...coords, toJSON: () => coords }, timestamp: 0, toJSON: () => ({ coords }) };
}

function mapButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="map"]');
  if (!button) throw new Error("the map is not rendered");
  return button;
}

describe("LocationPickerModal", () => {
  it("pans near the user once when it opens, not again after a pick", () => {
    render();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    const [onPosition] = defined(getCurrentPosition.mock.calls[0], "the geolocation request");
    act(() => onPosition(positionAt(52.5, 13.4)));
    expect(stubs.flyTo).toHaveBeenCalledTimes(1);
    expect(stubs.flyTo).toHaveBeenLastCalledWith({ center: [13.4, 52.5], zoom: 5 });

    act(() => mapButton().click());
    expect(container.textContent).toContain("38.720000, -9.140000");

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(stubs.flyTo).toHaveBeenCalledTimes(1);
  });

  it("keeps the view of a photo that already has a location", () => {
    render({ initialLat: 38.72, initialLon: -9.14 });

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});
