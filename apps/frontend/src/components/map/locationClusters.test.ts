import { describe, expect, it } from "vitest";
import { clusterFeatureCollection, clusterPoints } from "./locationClusters";

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
