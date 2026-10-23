import { describe, expect, it } from "vitest";
import {
  circleCollection,
  circlePolygon,
  destination,
  distanceM,
  edgeOf,
  placeAt,
  RADIUS_LIMITS,
  radiusTo,
} from "./placeGeometry";

const HOME = { lat: 48.13743, lon: 11.57549 };
const NEXT_DOOR = { lat: 48.13743, lon: 11.57616 };

describe("distanceM", () => {
  it("measures like the server", () => {
    expect(distanceM(HOME, NEXT_DOOR)).toBeCloseTo(50, 0);
    expect(distanceM(HOME, { lat: 52.52001, lon: 13.40495 }) / 1000).toBeCloseTo(504, -1);
  });
});

describe("destination", () => {
  it("goes the distance in the direction", () => {
    const north = destination(HOME, 1000, 0);
    expect(distanceM(HOME, north)).toBeCloseTo(1000, 3);
    expect(north.lat).toBeGreaterThan(HOME.lat);
    expect(north.lon).toBeCloseTo(HOME.lon, 9);
  });

  it("wraps across the 180th meridian", () => {
    expect(destination({ lat: 0, lon: 179.999 }, 2000, 90).lon).toBeLessThan(-179);
  });
});

describe("circlePolygon", () => {
  it("is a closed ring at the radius", () => {
    const ring = circlePolygon({ center: HOME, radiusM: 150 }).coordinates[0] ?? [];
    expect(ring.length).toBe(65);
    expect(ring[0]).toEqual(ring[64]);
    for (const [lon = 0, lat = 0] of ring) expect(distanceM(HOME, { lat, lon })).toBeCloseTo(150, 3);
  });

  it("collects circles and marks the active one", () => {
    const { features } = circleCollection(
      [
        { id: 1, center: HOME, radiusM: 100 },
        { id: 2, center: NEXT_DOOR, radiusM: 50 },
      ],
      2
    );
    expect(features.map(feature => feature.properties)).toEqual([
      { id: 1, active: false },
      { id: 2, active: true },
    ]);
  });
});

describe("radiusTo and edgeOf", () => {
  it("rounds a dragged radius and keeps it within the limits", () => {
    expect(radiusTo(HOME, NEXT_DOOR)).toBe(50);
    expect(radiusTo(HOME, HOME)).toBe(RADIUS_LIMITS.min);
    expect(radiusTo(HOME, { lat: 49, lon: 11 })).toBe(RADIUS_LIMITS.max);
  });

  it("puts the handle on the circle, east of the centre", () => {
    const edge = edgeOf({ center: HOME, radiusM: 300 });
    expect(distanceM(HOME, edge)).toBeCloseTo(300, 3);
    expect(edge.lon).toBeGreaterThan(HOME.lon);
  });
});

describe("placeAt", () => {
  const home = { id: 1, center_lat: HOME.lat, center_lon: HOME.lon, radius_m: 100 };
  const town = { id: 2, center_lat: HOME.lat, center_lon: HOME.lon, radius_m: 2000 };

  it("is the smallest place that holds the position", () => {
    expect(placeAt([town, home], NEXT_DOOR)?.id).toBe(1);
    expect(placeAt([town, home], destination(HOME, 1000, 0))?.id).toBe(2);
    expect(placeAt([town, home], { lat: 0, lon: 0 })).toBeUndefined();
  });
});
