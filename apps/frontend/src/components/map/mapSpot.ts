import type { MapBounds } from "@librephotos/api-client";
import type { Feature, Geometry } from "geojson";
import { zoomIntoCluster, type ClusterMap } from "./clusterZoom";
import { boundsAround } from "./photoPoints";

/** A point or cluster of the Places map that was opened: where its popover points, and its photos' bounds. */
export type MapSpot = Readonly<{ longitude: number; latitude: number; bounds: MapBounds }>;

/** A clicked feature of the map's "locations" source. */
type SpotFeature = Readonly<{ properties?: Record<string, unknown> | null; geometry: Geometry }>;

/** A clustered GeoJSON source, as far as reading a cluster's points needs it. */
type LeavesSource = Readonly<{
  type: string;
  getClusterLeaves: (clusterId: number, limit: number, offset: number) => Promise<Feature[]>;
}>;

/** The part of a MapLibre map (react-map-gl's MapRef) a spot reads. */
export type SpotMap = Readonly<{ getSource: (id: string) => Readonly<{ type: string }> | undefined }>;

// Enough for a cluster at the last zoom that still clusters; its bounds only need the extremes.
const MAX_LEAVES = 10_000;

// MapLibre refuses to register another source type under a built-in name, so
// "geojson" is always its own GeoJSONSource
function isLeavesSource(source: Readonly<{ type: string }> | undefined): source is LeavesSource {
  return source?.type === "geojson";
}

async function pointsOf(map: SpotMap, feature: SpotFeature, at: number[]): Promise<number[][]> {
  const clusterId = feature.properties?.cluster_id;
  if (typeof clusterId !== "number") return [at];
  const source = map.getSource("locations");
  if (!isLeavesSource(source)) return [];
  const leaves = await source.getClusterLeaves(clusterId, MAX_LEAVES, 0);
  return leaves.flatMap(leaf => (leaf.geometry.type === "Point" ? [leaf.geometry.coordinates] : []));
}

/**
 * The spot a click on `feature` opens: a single point's own position, or the bounds of every point
 * of a cluster. Null for anything that is not a point of the source.
 */
export async function spotFor(map: SpotMap, feature: SpotFeature): Promise<MapSpot | null> {
  if (feature.geometry.type !== "Point") return null;
  const [longitude, latitude] = feature.geometry.coordinates;
  if (longitude === undefined || latitude === undefined) return null;
  const bounds = boundsAround(await pointsOf(map, feature, [longitude, latitude]));
  return bounds && { longitude, latitude, bounds };
}

/** The part of a MapLibre map (react-map-gl's MapRef) a click on the Places map reads and moves. */
export type PlacesMapHandle = SpotMap & ClusterMap & Readonly<{ getZoom: () => number }>;

/** The part of a click event (react-map-gl's MapLayerMouseEvent) the Places map reads. */
export type MapClick = Readonly<{ point: Readonly<{ x: number; y: number }>; features?: readonly SpotFeature[] }>;

/**
 * What a click on the Places map opens. A cluster below `lastClusterZoom` zooms in until it
 * splits and opens nothing; a point, or a cluster at that zoom, opens its spot; a click beside
 * every feature opens nothing.
 */
export async function spotForClick(
  map: PlacesMapHandle,
  click: MapClick,
  lastClusterZoom: number
): Promise<MapSpot | null> {
  const feature = click.features?.[0];
  if (!feature) return null;
  if (typeof feature.properties?.cluster_id === "number" && map.getZoom() < lastClusterZoom) {
    await zoomIntoCluster(map, [click.point.x, click.point.y]);
    return null;
  }
  return spotFor(map, feature);
}
