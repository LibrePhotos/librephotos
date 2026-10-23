import { describe, expect, it } from "vitest";
import { boundsAround, mapBoundsOf, photoPointCollection } from "./photoPoints";

const view = (south: number, west: number, north: number, east: number) => ({
  getSouth: () => south,
  getWest: () => west,
  getNorth: () => north,
  getEast: () => east,
});

describe("photoPointCollection", () => {
  it("turns [lat, lon, photos] rows into points at [lon, lat] that carry the count", () => {
    expect(photoPointCollection([[48.1, 11.5, 3]])).toEqual({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { photos: 3 }, geometry: { type: "Point", coordinates: [11.5, 48.1] } },
      ],
    });
  });

  it("is empty before the points arrive and leaves out short rows", () => {
    expect(photoPointCollection(undefined).features).toEqual([]);
    expect(photoPointCollection([[48.1, 11.5]]).features).toEqual([]);
  });
});

describe("mapBoundsOf", () => {
  it("rounds the edges of a plain view", () => {
    expect(mapBoundsOf(view(47.123456, 10.987654, 49.5, 13.25))).toEqual({
      south: 47.1235,
      west: 10.9877,
      north: 49.5,
      east: 13.25,
    });
  });

  it("wraps a view panned past the 180th meridian, west then greater than east", () => {
    expect(mapBoundsOf(view(-20, 170, -10, 190))).toEqual({ south: -20, west: 170, north: -10, east: -170 });
  });

  it("takes every longitude for a view as wide as the world, and clamps the poles", () => {
    expect(mapBoundsOf(view(-95, -300, 95, 200))).toEqual({ south: -90, west: -180, north: 90, east: 180 });
  });
});

describe("boundsAround", () => {
  it("is null without positions", () => {
    expect(boundsAround([])).toBeNull();
  });

  it("spans the positions with a metre or two to spare", () => {
    const bounds = boundsAround([
      [11.5, 48.1],
      [11.6, 48.2],
    ]);
    expect(bounds?.south).toBeCloseTo(48.1, 4);
    expect(bounds?.north).toBeCloseTo(48.2, 4);
    expect(bounds?.west).toBeLessThan(11.5);
    expect(bounds?.east).toBeGreaterThan(11.6);
  });
});
