import { afterEach, describe, expect, it, vi } from "vitest";
import { zoomIntoCluster } from "./clusterZoom";
import type { ClusterMap } from "./clusterZoom";

// A click on a cluster of the Places map zooms in until the cluster splits.

type Feature = ReturnType<ClusterMap["queryRenderedFeatures"]>[number];
type Source = ReturnType<ClusterMap["getSource"]>;

const cluster: Feature = { properties: { cluster_id: 7 }, geometry: { type: "Point", coordinates: [13.4, 52.5] } };
const clusterSource = { type: "geojson", getClusterExpansionZoom: async (id: number) => id + 2 };

function stubMap(features: readonly Feature[], source: Source = clusterSource) {
  const easeTo = vi.fn<ClusterMap["easeTo"]>();
  const queryRenderedFeatures = vi.fn<ClusterMap["queryRenderedFeatures"]>(() => features);
  const map: ClusterMap = { queryRenderedFeatures, getSource: () => source, easeTo };
  return { map, easeTo, queryRenderedFeatures };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("zoomIntoCluster", () => {
  it("eases to the cluster at its expansion zoom", async () => {
    const { map, easeTo, queryRenderedFeatures } = stubMap([cluster]);
    await zoomIntoCluster(map, [10, 20]);

    expect(queryRenderedFeatures).toHaveBeenCalledWith([10, 20], { layers: ["clusters"] });
    expect(easeTo).toHaveBeenCalledWith({ center: [13.4, 52.5], zoom: 9 });
  });

  it("does nothing beside every cluster, on a feature that is not one, or without the clustered source", async () => {
    const beside = stubMap([]);
    const place = stubMap([{ properties: { name: "Berlin" }, geometry: cluster.geometry }]);
    const line = stubMap([{ properties: { cluster_id: 7 }, geometry: { type: "LineString", coordinates: [] } }]);
    const noCoordinates = stubMap([{ properties: { cluster_id: 7 }, geometry: { type: "Point", coordinates: [] } }]);
    const vectorSource = stubMap([cluster], { type: "vector" });

    for (const { map, easeTo } of [beside, place, line, noCoordinates, vectorSource]) {
      await zoomIntoCluster(map, [0, 0]);
      expect(easeTo).not.toHaveBeenCalled();
    }
  });

  it("logs a source that cannot tell the zoom, and stays put", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      type: "geojson",
      getClusterExpansionZoom: async () => Promise.reject(new Error("no such cluster")),
    };
    const { map, easeTo } = stubMap([cluster], failing);

    await zoomIntoCluster(map, [0, 0]);

    expect(easeTo).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });
});
