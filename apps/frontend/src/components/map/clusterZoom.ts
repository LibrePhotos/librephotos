import type { Geometry } from "geojson";

type ClusterFeature = Readonly<{ properties?: Record<string, unknown> | null; geometry: Geometry }>;

/** A clustered GeoJSON source: MapLibre's GeoJSONSource, as far as a cluster click needs it. */
type ClusterSource = Readonly<{ type: string; getClusterExpansionZoom: (clusterId: number) => Promise<number> }>;

/** The part of a MapLibre map (react-map-gl's MapRef) a cluster click reads and moves. */
export type ClusterMap = Readonly<{
  queryRenderedFeatures: (point: [number, number], options: { layers: string[] }) => readonly ClusterFeature[];
  getSource: (id: string) => Readonly<{ type: string }> | undefined;
  easeTo: (options: { center: [number, number]; zoom: number }) => unknown;
}>;

// MapLibre refuses to register another source type under a built-in name, so
// "geojson" is always its own GeoJSONSource
function isClusterSource(source: Readonly<{ type: string }> | undefined): source is ClusterSource {
  return source?.type === "geojson";
}

/**
 * Zooms the Places map into the cluster at `point` (layer "clusters" of source "locations"), as far
 * as it takes for the cluster to split. A click beside every cluster does nothing.
 */
export async function zoomIntoCluster(map: ClusterMap, point: [number, number]): Promise<void> {
  const feature = map.queryRenderedFeatures(point, { layers: ["clusters"] })[0];
  const clusterId = feature?.properties?.cluster_id;
  const source = map.getSource("locations");
  // A cluster is always a point
  if (feature?.geometry.type !== "Point" || typeof clusterId !== "number" || !isClusterSource(source)) return;
  const [lng, lat] = feature.geometry.coordinates;
  if (lng === undefined || lat === undefined) return;
  try {
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({ center: [lng, lat], zoom });
  } catch (err) {
    console.error("Error getting cluster expansion zoom:", err);
  }
}
