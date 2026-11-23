import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapLayerColors } from "../../theme/mapColors";
import { clusterLayers, PHOTO_DENSITY_SOURCE } from "./placesLayers";

const colors = mapLayerColors("light");
const layers = clusterLayers(colors);

describe("clusterLayers", () => {
  it("keeps the cluster, count and point layers on the clustered locations source", () => {
    expect(layers.clusters.type).toBe("circle");
    expect(layers.clusterCount.type).toBe("symbol");
    expect(layers.unclusteredPoint.type).toBe("circle");
    for (const layer of [layers.clusters, layers.clusterCount, layers.unclusteredPoint]) {
      expect(layer.source).toBe("locations");
    }
  });

  it("draws the heatmap from every point, not from the cluster centres", () => {
    expect(layers.heatmap).toMatchObject({ id: "photo-heatmap", type: "heatmap", source: PHOTO_DENSITY_SOURCE });
    expect(PHOTO_DENSITY_SOURCE).not.toBe("locations");
  });

  it("weighs a point by its photos without saturating at a hundred", () => {
    expect(layers.heatmap.paint?.["heatmap-weight"]).toEqual([
      "interpolate",
      ["linear"],
      ["get", "photos"],
      1,
      0.35,
      10,
      0.6,
      100,
      0.85,
      1000,
      1,
    ]);
  });

  it("grows the radius and the intensity with the zoom", () => {
    const values = (expression: unknown): number[] => {
      const parts: readonly unknown[] = Array.isArray(expression) ? expression : [];
      return parts.slice(3).filter((part, index): part is number => index % 2 === 1 && typeof part === "number");
    };
    const radius = values(layers.heatmap.paint?.["heatmap-radius"]);
    const intensity = values(layers.heatmap.paint?.["heatmap-intensity"]);

    expect(radius.length).toBeGreaterThan(2);
    expect(radius).toEqual([...radius].sort((a, b) => a - b));
    expect(intensity).toEqual([...intensity].sort((a, b) => a - b));
    expect(radius[0]).toBeGreaterThanOrEqual(10);
  });

  it("spreads a city into a soft patch at world zoom and merges a city's spots up close", () => {
    const stops = (expression: unknown): Map<number, number> => {
      const parts: readonly unknown[] = Array.isArray(expression) ? expression : [];
      const pairs = parts.slice(3);
      return new Map(
        pairs.flatMap((part, index) => {
          const output = pairs[index + 1];
          return index % 2 === 0 && typeof part === "number" && typeof output === "number" ? [[part, output]] : [];
        })
      );
    };
    const radius = stops(layers.heatmap.paint?.["heatmap-radius"]);
    const intensity = stops(layers.heatmap.paint?.["heatmap-intensity"]);

    expect(radius.get(0)).toBeGreaterThanOrEqual(25);
    expect(intensity.get(0)).toBeLessThan(1);
    expect(radius.get(12)).toBeGreaterThanOrEqual(50);
  });

  it("colours the density with the map colour module's ramp, faded in from transparent", () => {
    const ramp: readonly unknown[] = layers.heatmap.paint?.["heatmap-color"] ?? [];
    expect(ramp.slice(3).filter((_, index) => index % 2 === 1)).toEqual([colors.heatmap.fade, ...colors.heatmap.ramp]);
  });
});

describe("Places map layering", () => {
  const css = readFileSync(resolve(__dirname, "PlacesPhotoMap.module.css"), "utf8");
  const rule = (selector: string) => new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  it("keeps the map's own stacking inside its frame, so the mode switch sits on top", () => {
    expect(rule(".map")).toContain("isolation: isolate;");
    expect(rule(".modeToggle")).toMatch(/z-index: [1-9]/);
  });
});
