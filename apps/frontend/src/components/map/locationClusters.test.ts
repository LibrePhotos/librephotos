import { describe, expect, it } from "vitest";
import { clusterFeatureCollection, clusterPoints, initialViewForClusters, WORLD_VIEW } from "./locationClusters";

describe("clusterPoints", () => {
  it("reads the backend's [lng, lat, name] rows", () => {
    expect(clusterPoints([[13.4, 52.5, "Berlin"]])).toEqual([{ lng: 13.4, lat: 52.5, name: "Berlin" }]);
  });

  it("keeps a place at longitude 0, which the bounds check still counts", () => {
    expect(clusterPoints([[0, 51.48, "Greenwich"]])).toEqual([{ lng: 0, lat: 51.48, name: "Greenwich" }]);
  });

  it("leaves out rows of another shape", () => {
    expect(
      clusterPoints([
        ["13.4", 52.5, "Berlin"],
        [13.4, 52.5],
        [13.4, 52.5, 7],
      ])
    ).toEqual([]);
  });
});

describe("clusterFeatureCollection", () => {
  it("is an empty collection before the clusters arrive", () => {
    expect(clusterFeatureCollection(undefined)).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("drops longitude 0 and numbers the features that are left", () => {
    const { features } = clusterFeatureCollection([
      [0, 51.48, "Greenwich"],
      [13.4, 52.5, "Berlin"],
    ]);
    expect(features).toEqual([
      {
        type: "Feature",
        properties: { name: "Berlin", id: 0 },
        geometry: { type: "Point", coordinates: [13.4, 52.5] },
      },
    ]);
  });
});

describe("initialViewForClusters", () => {
  const FIT = { padding: 40, maxZoom: 10 };

  it("opens on the world view when there are no places", () => {
    expect(initialViewForClusters(clusterFeatureCollection([]), FIT)).toEqual(WORLD_VIEW);
  });

  it("opens on the caller's world view when it brings its own", () => {
    const world = { longitude: 0, latitude: 30, zoom: 0.8 };
    expect(initialViewForClusters(clusterFeatureCollection(undefined), FIT, world)).toBe(world);
  });

  it("fits a single place, which the fit options cap at their zoom", () => {
    expect(initialViewForClusters(clusterFeatureCollection([[13.4, 52.5, "Berlin"]]), FIT)).toEqual({
      bounds: [
        [13.4, 52.5],
        [13.4, 52.5],
      ],
      fitBoundsOptions: FIT,
    });
  });

  it("spans places far apart, on both sides of the equator and the meridian", () => {
    const collection = clusterFeatureCollection([
      [13.4, 52.5, "Berlin"],
      [151.21, -33.87, "Sydney"],
      [-122.42, 37.77, "San Francisco"],
    ]);
    expect(initialViewForClusters(collection, { padding: 12, maxZoom: 4 })).toEqual({
      bounds: [
        [-122.42, -33.87],
        [151.21, 52.5],
      ],
      fitBoundsOptions: { padding: 12, maxZoom: 4 },
    });
  });
});
