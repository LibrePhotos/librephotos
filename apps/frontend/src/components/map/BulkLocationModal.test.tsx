/**
 * Setting the location of the selected photos (#2279): the dialog says how many already have one,
 * sends `overwrite` by the chosen option, and copies a location from a photo taken nearby in time.
 */
import type { LocatedPhoto, LocationSummaryResponse } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetPhotosLocationRequest } from "../../api_client/photos/hooks/useSetPhotosLocationMutation";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { defined } from "../../util/defined.test-utils";
import { BulkLocationModal } from "./BulkLocationModal";

type Summary = { data?: LocationSummaryResponse; isError: boolean; isFetching: boolean };

const stubs = vi.hoisted(() => ({
  summarySelection: vi.fn<(selection: PhotoSelection | null) => void>(),
  summary: { current: { isError: false, isFetching: false } as Summary },
  nearbySpan: vi.fn<(span: { from: string; to: string } | null) => void>(),
  nearby: { current: undefined as LocatedPhoto[] | undefined },
  mutate: vi.fn<(request: SetPhotosLocationRequest, options?: { onSuccess?: () => void }) => void>(),
}));

// Interpolation options show up in the text, so counts and places can be asserted.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
  }),
}));
vi.mock("../../util/mapStyle", () => ({ useMapStyle: () => ({ mapStyle: null, mapsDisabled: true }) }));
vi.mock("./mapImages", () => ({ ignoreMissingStyleImages: () => {} }));
vi.mock("../lightbox/WriteBackHint", () => ({ WriteBackHint: () => null }));
vi.mock("../../api_client/geocode", () => ({
  useGeocodeSearchQuery: () => ({ data: undefined, isLoading: false }),
  useReverseGeocodeQuery: () => ({ data: undefined, isPending: true }),
}));
vi.mock("../../api_client/photos/hooks/useLocationSummaryQuery", () => ({
  useLocationSummaryQuery: (selection: PhotoSelection | null) => {
    stubs.summarySelection(selection);
    return { ...stubs.summary.current, refetch: () => Promise.resolve() };
  },
}));
vi.mock("../../api_client/photos/hooks/useLocatedNearbyQuery", () => ({
  useLocatedNearbyQuery: (span: { from: string; to: string } | null) => {
    stubs.nearbySpan(span);
    return { data: stubs.nearby.current };
  },
}));
vi.mock("../../api_client/photos/hooks/useSetPhotosLocationMutation", () => ({
  useSetPhotosLocationMutation: () => ({ mutate: stubs.mutate, isPending: false }),
}));
vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "" }));

const SELECTION: PhotoSelection = { image_hashes: ["a", "b"] };
const PORTO: LocatedPhoto = {
  id: "0b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10",
  image_hash: "porto",
  exif_timestamp: "2026-10-11T07:43:00Z",
  exif_gps_lat: 41.14,
  exif_gps_lon: -8.61,
  place: "Ribeira, Porto, Portugal",
  short_place: "Porto",
};

function summary(count: number, withLocation: number): LocationSummaryResponse {
  return {
    count,
    with_location: withLocation,
    places: withLocation ? [{ place: "Lisbon", count: withLocation }] : [],
    first_taken: "2026-10-11T09:00:00Z",
    last_taken: "2026-10-11T18:00:00Z",
  };
}

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
  stubs.summarySelection.mockReset();
  stubs.nearbySpan.mockReset();
  stubs.mutate.mockReset();
  stubs.nearby.current = [PORTO];
  stubs.summary.current = { data: summary(24, 9), isError: false, isFetching: false };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(onClose = () => {}, onDone = () => {}) {
  act(() => {
    root.render(
      <MantineProvider env="test">
        <BulkLocationModal opened onClose={onClose} selection={SELECTION} onDone={onDone} />
      </MantineProvider>
    );
  });
}

function button(name: string): HTMLButtonElement {
  return defined(
    [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      candidate =>
        candidate.textContent?.startsWith(name) === true || candidate.getAttribute("aria-label")?.startsWith(name)
    ),
    `the button "${name}"`
  );
}

function radio(value: string): HTMLInputElement {
  return defined(document.body.querySelector<HTMLInputElement>(`input[type=radio][value=${value}]`), value);
}

function copyPorto() {
  act(() => button("locationpicker.copy_from_photo").click());
}

describe("BulkLocationModal", () => {
  it("asks about the selection, and for the photos taken a day around it", () => {
    render();

    expect(stubs.summarySelection).toHaveBeenLastCalledWith(SELECTION);
    expect(stubs.nearbySpan).toHaveBeenLastCalledWith({
      from: "2026-10-10T09:00:00.000Z",
      to: "2026-10-12T18:00:00.000Z",
    });
    expect(document.body.textContent).toContain('locationpicker.bulk_title {"count":24}');
  });

  it("says how many have a location and sets only the others by default", () => {
    const onClose = vi.fn<() => void>();
    const onDone = vi.fn<() => void>();
    render(onClose, onDone);

    expect(document.body.textContent).toContain('locationpicker.bulk_located {"count":9,"total":24}');
    expect(radio("missing").checked).toBe(true);
    expect(document.body.textContent).not.toContain("locationpicker.bulk_replaces");
    copyPorto();
    act(() => button("locationpicker.bulk_save").click());

    const [request, options] = defined(stubs.mutate.mock.calls[0], "the save");
    expect(request).toEqual({ selection: SELECTION, lat: 41.14, lon: -8.61, overwrite: false });
    expect(button("locationpicker.bulk_save").textContent).toContain('{"count":15}');
    act(() => options?.onSuccess?.());
    expect(onClose).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("replaces every location when asked, naming the places", () => {
    render();

    act(() => radio("all").click());

    expect(document.body.textContent).toContain('locationpicker.bulk_replaces_places {"count":9,"places":"Lisbon"}');
    copyPorto();
    act(() => button("locationpicker.bulk_save").click());
    expect(defined(stubs.mutate.mock.calls[0])[0].overwrite).toBe(true);
    expect(button("locationpicker.bulk_save").textContent).toContain('{"count":24}');
  });

  it("fills the spot and its place name from a photo taken nearby", () => {
    render();

    copyPorto();

    expect(button("locationpicker.copy_from_photo").getAttribute("aria-pressed")).toBe("true");
    expect(document.body.querySelector('[data-testid="picked-place"]')?.textContent).toContain(
      "Ribeira, Porto, Portugal"
    );
  });

  it("does not save before a spot is picked", () => {
    render();

    act(() => button("locationpicker.bulk_save").click());

    expect(button("locationpicker.bulk_save").getAttribute("aria-disabled")).toBe("true");
    expect(stubs.mutate).not.toHaveBeenCalled();
  });

  it("offers no choice when every photo has a location, and replaces them", () => {
    stubs.summary.current = { data: summary(3, 3), isError: false, isFetching: false };
    render();

    expect(document.body.querySelector("input[type=radio]")).toBeNull();
    expect(document.body.textContent).toContain("locationpicker.bulk_all_located_places");
    copyPorto();
    act(() => button("locationpicker.bulk_save").click());
    expect(defined(stubs.mutate.mock.calls[0])[0].overwrite).toBe(true);
  });

  it("offers no choice when none has a location", () => {
    stubs.summary.current = { data: summary(4, 0), isError: false, isFetching: false };
    render();

    expect(document.body.querySelector("input[type=radio]")).toBeNull();
    expect(document.body.textContent).not.toContain("bulk_all_located");
  });

  it("says so when the server could not be asked", () => {
    stubs.summary.current = { isError: true, isFetching: false };
    render();

    expect(document.body.querySelector("[role=alert]")).not.toBeNull();
    expect(() => button("locationpicker.bulk_save")).toThrow();
  });
});
