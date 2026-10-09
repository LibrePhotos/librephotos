import type { FeatureCollection, Point } from "geojson";
import type { LocationClusters } from "../../api_client/albums/hooks";

/** A named place from the location cluster list. */
export type ClusterPoint = Readonly<{ lng: number; lat: number; name: string }>;

/** What each place feature carries: its name, and its position in the collection. */
export type ClusterFeatureProperties = Readonly<{ name: string; id: number }>;

/**
 * The places in a location cluster list. The backend sends one
 * `[lng, lat, name]` row per place (api/stats.py, _location_cluster_row), but
 * the schema allows any mix of numbers and strings, so rows of another shape
 * are left out.
 */
export function clusterPoints(clusters: LocationClusters): ClusterPoint[] {
  return clusters.flatMap(([lng, lat, name]) =>
    typeof lng === "number" && typeof lat === "number" && typeof name === "string" ? [{ lng, lat, name }] : []
  );
}

/** The places as a GeoJSON source, leaving out the ones at longitude 0. */
export function clusterFeatureCollection(
  clusters: LocationClusters | undefined
): FeatureCollection<Point, ClusterFeatureProperties> {
  const features = clusterPoints(clusters ?? [])
    .filter(point => point.lng !== 0)
    .map((point, idx) => ({
      type: "Feature" as const,
      properties: { name: point.name, id: idx },
      geometry: {
        type: "Point" as const,
        coordinates: [point.lng, point.lat], // [lng, lat]
      },
    }));
  return { type: "FeatureCollection", features };
}
