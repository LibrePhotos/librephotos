/**
 * The location picker (#2283, #2209): it never asks the browser for the user's position on its
 * own, a photo without a location opens on the whole world, a pasted "lat, lon" is used without a
 * place search, the picked spot is named before saving, and a photo's location can be removed.
 */
import type { GeocodeReverseResponse, Photo } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import type { FlyToOptions } from "maplibre-gl";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { LocationPickerModal } from "./LocationPickerModal";

type UpdateArgs = { id: string; data: Partial<Photo> };
type ViewState = { latitude: number; longitude: number; zoom: number };
type ReverseLookup = { data?: GeocodeReverseResponse; isPending: boolean };

const stubs = vi.hoisted(() => ({
  flyTo: vi.fn<(options: FlyToOptions) => void>(),
  geocodeSearch: vi.fn<(query: string, enabled: boolean) => void>(),
  reverseLookup: vi.fn<(position: readonly [number, number] | null) => void>(),
  reverseAnswer: { current: { data: undefined, isPending: true } as ReverseLookup },
  mutate: vi.fn<(args: UpdateArgs, options?: { onSuccess?: () => void }) => void>(),
  invalidatePlaces: vi.fn<() => void>(),
  viewState: { current: undefined as ViewState | undefined },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../util/mapStyle", () => ({
  useMapStyle: () => ({ mapStyle: "https://example.invalid/style.json", mapsDisabled: false }),
}));
vi.mock("./mapImages", () => ({ ignoreMissingStyleImages: () => {} }));
vi.mock("../../api_client/geocode", () => ({
  useGeocodeSearchQuery: (query: string, enabled: boolean) => {
    stubs.geocodeSearch(query, enabled);
    return { data: undefined, isLoading: false };
  },
  useReverseGeocodeQuery: (position: readonly [number, number] | null) => {
    stubs.reverseLookup(position);
    return stubs.reverseAnswer.current;
  },
}));
vi.mock("../../api_client/photos/hooks/useUpdatePhotoMutation", () => ({
  useUpdatePhotoMutation: () => ({ mutate: stubs.mutate, isPending: false }),
}));
vi.mock("../../api_client/albums/invalidatePlaces", () => ({ invalidatePlaces: stubs.invalidatePlaces }));

// Stands in for react-map-gl's <Map>: a click on it picks a fixed spot, its handle flies, and
// the marker shows where it is.
vi.mock("react-map-gl/maplibre", async () => {
  const react = await import("react");
  type ClickEvent = { lngLat: { lat: number; lng: number } };
  const MapGL = react.forwardRef(function MapGL(
    props: { children?: React.ReactNode; onClick?: (event: ClickEvent) => void; initialViewState?: ViewState },
    ref: React.ForwardedRef<{ flyTo: typeof stubs.flyTo }>
  ) {
    react.useImperativeHandle(ref, () => ({ flyTo: stubs.flyTo }), []);
    stubs.viewState.current = props.initialViewState;
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
    Marker: (props: { latitude: number; longitude: number }) =>
      react.createElement("div", { "data-testid": "marker" }, `${props.latitude},${props.longitude}`),
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
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  stubs.flyTo.mockReset();
  stubs.geocodeSearch.mockReset();
  stubs.reverseLookup.mockReset();
  stubs.mutate.mockReset();
  stubs.invalidatePlaces.mockReset();
  stubs.reverseAnswer.current = { data: undefined, isPending: true };
  stubs.viewState.current = undefined;
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
  vi.useRealTimers();
});

type RenderProps = {
  initialLat?: number;
  initialLon?: number;
  initialPlace?: string;
  onClose?: () => void;
  onNestedDialogChange?: (opened: boolean) => void;
};

function render(props: RenderProps = {}) {
  act(() => {
    root.render(
      <MantineProvider env="test">
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

function byTestId(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    candidate => candidate.textContent === name || candidate.getAttribute("aria-label") === name
  );
  if (!button) throw new Error(`no button "${name}"`);
  return button;
}

function type(text: string) {
  const input = defined(container.querySelector<HTMLInputElement>("input"), "the search box");
  const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set, "value setter");
  act(() => {
    input.focus();
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("LocationPickerModal: opening", () => {
  it("does not ask the browser where the user is when it opens", () => {
    render();

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("starts a photo without a location on the whole world", () => {
    render();

    expect(stubs.viewState.current).toEqual({ latitude: 20, longitude: 0, zoom: 1 });
    expect(byTestId("marker")).toBeNull();
  });

  it("starts a located photo on its location, with its place name", () => {
    render({ initialLat: 38.72, initialLon: -9.14, initialPlace: "Lisbon, Portugal" });

    expect(stubs.viewState.current).toEqual({ latitude: 38.72, longitude: -9.14, zoom: 13 });
    expect(byTestId("picked-place")?.textContent).toContain("Lisbon, Portugal");
    expect(stubs.reverseLookup).toHaveBeenLastCalledWith(null);
  });
});

describe("LocationPickerModal: use my current location", () => {
  it("asks the browser only on the button and flies to the answer", () => {
    render();
    act(() => buttonNamed("locationpicker.use_my_location").click());
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    const [onPosition] = defined(getCurrentPosition.mock.calls[0], "the geolocation request");
    act(() => onPosition(positionAt(52.5, 13.4)));

    expect(stubs.flyTo).toHaveBeenLastCalledWith({ center: [13.4, 52.5], zoom: 13 });
    expect(byTestId("marker")?.textContent).toBe("52.5,13.4");
  });

  it.each([
    [1, "locationpicker.permission_denied"],
    [3, "locationpicker.timeout"],
    [99, "locationpicker.unknown_error"],
  ])("says why the browser gave no position for error code %i", (code, message) => {
    render({ initialLat: 38.72, initialLon: -9.14 });
    act(() => buttonNamed("locationpicker.use_my_location").click());

    const [, onError] = defined(getCurrentPosition.mock.calls[0], "the geolocation request");
    const error = { code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as const;
    act(() => onError?.(error));

    expect(container.textContent).toContain(message);
  });
});

describe("LocationPickerModal: pasted coordinates", () => {
  it("offers typed coordinates and uses them without a place search", () => {
    render();
    type("48.8566, 2.3522");

    expect(stubs.geocodeSearch).toHaveBeenLastCalledWith(expect.any(String), false);
    const option = defined(
      [...document.body.querySelectorAll<HTMLElement>("[role=option]")].find(element =>
        element.textContent?.includes("locationpicker.use_coordinates")
      ),
      "the coordinates option"
    );
    act(() => option.click());

    expect(byTestId("marker")?.textContent).toBe("48.8566,2.3522");
    expect(stubs.flyTo).toHaveBeenLastCalledWith({ center: [2.3522, 48.8566], zoom: 13 });
  });

  it("explains coordinates off the globe instead of searching", () => {
    render();
    type("152.5, 13.37");

    expect(document.body.textContent).toContain("locationpicker.not_a_position");
    expect(stubs.geocodeSearch).toHaveBeenLastCalledWith(expect.any(String), false);
  });

  it("searches a place name", () => {
    render();
    type("Berlin");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(stubs.geocodeSearch).toHaveBeenLastCalledWith("Berlin", true);
  });
});

describe("LocationPickerModal: the picked place", () => {
  it("looks a moved marker up once it rests and shows its name", () => {
    render({ initialLat: 40.4, initialLon: -3.7 });
    // The photo's own spot without a place name is looked up at once.
    expect(stubs.reverseLookup).toHaveBeenLastCalledWith([40.4, -3.7]);

    act(() => defined(byTestId("map"), "the map").click());
    expect(byTestId("picked-place")?.textContent).toContain("locationpicker.looking_up");
    expect(stubs.reverseLookup).toHaveBeenLastCalledWith(null);

    stubs.reverseAnswer.current = { data: { enabled: true, place: "Lisbon, Portugal" }, isPending: false };
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(stubs.reverseLookup).toHaveBeenLastCalledWith([38.72, -9.14]);
    expect(byTestId("picked-place")?.textContent).toContain("Lisbon, Portugal");
    expect(byTestId("picked-place")?.textContent).toContain("38.720000, -9.140000");
  });

  it.each<[GeocodeReverseResponse | undefined, string]>([
    [{ enabled: true, place: null }, "locationpicker.place_unavailable"],
    [undefined, "locationpicker.place_unavailable"],
    [{ enabled: false, place: null }, "locationpicker.place_names_off"],
  ])("says when there is no name (%j)", (data, message) => {
    stubs.reverseAnswer.current = { data, isPending: false };
    render();
    act(() => defined(byTestId("map"), "the map").click());
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(byTestId("picked-place")?.textContent).toContain(message);
    expect(buttonNamed("save").disabled).toBe(false);
  });

  it("saves the picked spot and closes", () => {
    const onClose = vi.fn<() => void>();
    render({ onClose });
    act(() => defined(byTestId("map"), "the map").click());
    act(() => buttonNamed("save").click());

    const [args, options] = defined(stubs.mutate.mock.calls[0], "the save");
    expect(args).toEqual({ id: "abc", data: { exif_gps_lat: 38.72, exif_gps_lon: -9.14 } });
    act(() => options?.onSuccess?.());
    expect(stubs.invalidatePlaces).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("LocationPickerModal: remove location", () => {
  it("offers no removal to a photo without a location", () => {
    render();

    expect(() => buttonNamed("locationpicker.remove_location")).toThrow();
  });

  it("asks first, then sends both coordinates as null and closes", () => {
    const onClose = vi.fn<() => void>();
    const onNestedDialogChange = vi.fn<(opened: boolean) => void>();
    render({ initialLat: 38.72, initialLon: -9.14, onClose, onNestedDialogChange });

    act(() => buttonNamed("locationpicker.remove_location").click());
    expect(document.body.textContent).toContain("locationpicker.remove_message");
    expect(onNestedDialogChange).toHaveBeenLastCalledWith(true);
    expect(stubs.mutate).not.toHaveBeenCalled();

    const confirm = defined(
      [...document.body.querySelectorAll<HTMLButtonElement>("button")].filter(
        button => button.textContent === "locationpicker.remove_location"
      )[1],
      "the confirmation's button"
    );
    act(() => confirm.click());

    const [args, options] = defined(stubs.mutate.mock.calls[0], "the removal");
    expect(args).toEqual({ id: "abc", data: { exif_gps_lat: null, exif_gps_lon: null } });
    act(() => options?.onSuccess?.());
    expect(stubs.invalidatePlaces).toHaveBeenCalled();
    expect(onNestedDialogChange).toHaveBeenLastCalledWith(false);
    expect(onClose).toHaveBeenCalled();
  });
});
