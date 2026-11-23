import { describe, expect, it } from "vitest";
import { mapLayerColors } from "../../theme/mapColors";
import { clusterLayers } from "./placesLayers";

const layers = clusterLayers(mapLayerColors("light"));

describe("clusterLayers", () => {
  it("keeps the cluster, count and point layers on the locations source", () => {
    expect(layers.clusters.type).toBe("circle");
    expect(layers.clusterCount.type).toBe("symbol");
    expect(layers.unclusteredPoint.type).toBe("circle");
    for (const layer of [layers.clusters, layers.clusterCount, layers.unclusteredPoint, layers.heatmap]) {
      expect(layer.source).toBe("locations");
    }
  });

  it("adds a heatmap layer weighted by the point's photo count", () => {
    expect(layers.heatmap).toMatchObject({ id: "photo-heatmap", type: "heatmap" });
    expect(layers.heatmap.paint?.["heatmap-weight"]).toEqual([
      "interpolate",
      ["linear"],
      ["get", "photos"],
      0,
      0,
      10,
      0.4,
      100,
      1,
    ]);
  });
});
