import type { Feature } from "geojson";
import { describe, expect, it, vi } from "vitest";
import type { ClusterMap } from "./clusterZoom";
import { spotFor, spotForClick, type PlacesMapHandle, type SpotMap } from "./mapSpot";

const point = (lng: number, lat: number, properties: Record<string, unknown> = { photos: 1 }) => ({
  properties,
  geometry: { type: "Point" as const, coordinates: [lng, lat] },
});

const leaf = (lng: number, lat: number): Feature => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Point", coordinates: [lng, lat] },
});

type GetLeaves = (clusterId: number, limit: number, offset: number) => Promise<Feature[]>;

function clusterSource(leaves: Feature[], expansionZoom = 7) {
  const getClusterLeaves = vi.fn<GetLeaves>(() => Promise.resolve(leaves));
  return {
    source: {
      type: "geojson",
      getClusterLeaves,
      getClusterExpansionZoom: (_clusterId: number) => Promise.resolve(expansionZoom),
    },
    getClusterLeaves,
  };
}

describe("spotFor", () => {
  it("opens a single point at its own position", async () => {
    const { source } = clusterSource([]);
    const spot = await spotFor({ getSource: () => source }, point(11.5, 48.1));
    expect(spot?.longitude).toBe(11.5);
    expect(spot?.bounds.south).toBeLessThan(48.1);
    expect(spot?.bounds.north).toBeGreaterThan(48.1);
  });

  it("opens a cluster over the bounds of all its points", async () => {
    const { source, getClusterLeaves } = clusterSource([leaf(11.4, 48.0), leaf(11.6, 48.3)]);
    const spot = await spotFor({ getSource: () => source }, point(11.5, 48.1, { cluster_id: 7, photos: 9 }));
    expect(getClusterLeaves).toHaveBeenCalledWith(7, expect.any(Number), 0);
    expect(spot?.bounds.west).toBeLessThan(11.4);
    expect(spot?.bounds.north).toBeGreaterThan(48.3);
  });

  it("opens nothing for a shape that is not a point", async () => {
    const line = { properties: {}, geometry: { type: "LineString" as const, coordinates: [[0, 0]] } };
    expect(await spotFor({ getSource: () => undefined }, line)).toBeNull();
  });

  it("opens nothing for a cluster when the source is gone", async () => {
    const map: SpotMap = { getSource: () => undefined };
    expect(await spotFor(map, point(1, 2, { cluster_id: 1 }))).toBeNull();
  });
});

describe("spotForClick", () => {
  const cluster = point(11.5, 48.1, { cluster_id: 7, photos: 9 });

  function handle(zoom: number) {
    const easeTo = vi.fn<ClusterMap["easeTo"]>();
    const { source } = clusterSource([leaf(11.5, 48.1)]);
    const map: PlacesMapHandle = {
      getZoom: () => zoom,
      getSource: () => source,
      queryRenderedFeatures: () => [cluster],
      easeTo,
    };
    return { map, easeTo };
  }

  it("zooms into a cluster below the last clustering zoom and opens nothing", async () => {
    const { map, easeTo } = handle(5);
    expect(await spotForClick(map, { point: { x: 1, y: 2 }, features: [cluster] }, 14)).toBeNull();
    expect(easeTo).toHaveBeenCalledWith({ center: [11.5, 48.1], zoom: 7 });
  });

  it("opens a cluster at the last clustering zoom", async () => {
    const { map, easeTo } = handle(14);
    const spot = await spotForClick(map, { point: { x: 1, y: 2 }, features: [cluster] }, 14);
    expect(spot?.longitude).toBe(11.5);
    expect(easeTo).not.toHaveBeenCalled();
  });

  it("opens a point, and nothing for a click beside every feature", async () => {
    const { map } = handle(5);
    const spot = await spotForClick(map, { point: { x: 1, y: 2 }, features: [point(1, 2)] }, 14);
    expect(spot?.latitude).toBe(2);
    expect(await spotForClick(map, { point: { x: 1, y: 2 }, features: [] }, 14)).toBeNull();
    expect(await spotForClick(map, { point: { x: 1, y: 2 } }, 14)).toBeNull();
  });
});
