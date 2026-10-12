/**
 * A maplibre render error stays inside the map: the page around it keeps
 * rendering and the map's place shows the inline fallback with Retry.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import i18n from "../i18n";
import { AlbumLocationMap } from "./AlbumLocationMap";

const map = vi.hoisted(() => ({ throws: true }));

vi.mock("../util/mapStyle", () => ({
  useMapStyle: () => ({ mapStyle: "https://example.invalid/style.json", mapsDisabled: false }),
}));

vi.mock("react-map-gl/maplibre", () => ({
  default: (props: { children?: React.ReactNode }) => {
    if (map.throws) throw new Error("WebGL context lost");
    return <div data-testid="map">{props.children}</div>;
  },
  Marker: () => null,
  NavigationControl: () => null,
  AttributionControl: () => null,
}));

let root: Root;
let container: HTMLDivElement;
let consoleError: MockInstance<Console["error"]>;

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
  map.throws = true;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  consoleError.mockRestore();
});

describe("AlbumLocationMap error boundary", () => {
  it("shows the fallback in place of a throwing map and keeps the page", async () => {
    await act(async () => {
      root.render(
        <MantineProvider>
          <div data-testid="grid">grid</div>
          <AlbumLocationMap photos={[{ id: "a", exif_gps_lat: 52.5, exif_gps_lon: 13.4 }]} />
        </MantineProvider>
      );
    });

    expect(container.querySelector("[data-testid=grid]")).not.toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain(i18n.t("featureboundary.title"));

    map.throws = false;
    const retry = [...container.querySelectorAll("button")].find(
      b => b.textContent === i18n.t("featureboundary.retry")
    );
    await act(async () => retry?.click());

    expect(container.querySelector("[data-testid=map]")).not.toBeNull();
  });
});
