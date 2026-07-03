import { describe, expect, test } from "vitest";
import { OSM_STYLE, PHOTOPRISM_STYLE_URL, resolveMapStyle } from "./mapStyle";

describe("resolveMapStyle", () => {
  test("defaults to the PhotoPrism style URL", () => {
    expect(resolveMapStyle("photoprism")).toBe(PHOTOPRISM_STYLE_URL);
  });

  test("falls back to PhotoPrism when the provider is undefined (settings still loading)", () => {
    expect(resolveMapStyle(undefined)).toBe(PHOTOPRISM_STYLE_URL);
  });

  test("returns the OSM style object for the osm provider", () => {
    expect(resolveMapStyle("osm")).toBe(OSM_STYLE);
  });

  test("returns null when the provider is none (map disabled)", () => {
    expect(resolveMapStyle("none")).toBeNull();
  });
});
