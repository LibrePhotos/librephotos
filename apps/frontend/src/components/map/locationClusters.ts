import type { LocationClusters } from "@librephotos/api-client";
import type { FeatureCollection, GeoJsonProperties, Point } from "geojson";

/** A named place from the location cluster list. */
export type ClusterPoint = Readonly<{ lng: number; lat: number; name: string }>;

/** What each place feature carries: its name, and its position in the collection. */
export type ClusterFeatureProperties = Readonly<{ name: string; id: number }>;

/**
 * The places in a location cluster list. The backend sends one
 * `[lng, lat, name]` row per place (api/dataviz/stats.py, _location_cluster_row), but
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

/** A map's opening camera: a fixed centre and zoom. */
export type MapView = Readonly<{ longitude: number; latitude: number; zoom: number }>;

/** How a map fits its places: room around the edge points, and how close one place may bring it. */
export type FitOptions = Readonly<{ padding: number; maxZoom: number }>;

/** A map's opening camera: a fixed view, or the box around its places. */
export type InitialMapView =
  MapView | Readonly<{ bounds: [[number, number], [number, number]]; fitBoundsOptions: FitOptions }>;

/** Where a map opens when there is nothing to fit it to. */
export const WORLD_VIEW: MapView = { longitude: 0, latitude: 40, zoom: 2 };

/**
 * Opens a map on every place in the collection, or on `world` when it has none. A single place
 * opens at `fit.maxZoom` around it.
 */
export function initialViewForClusters<P extends GeoJsonProperties>(
  collection: FeatureCollection<Point, P>,
  fit: FitOptions,
  world: MapView = WORLD_VIEW
): InitialMapView {
  const coordinates = collection.features.map(feature => feature.geometry.coordinates);
  const longitudes = coordinates.flatMap(([lng]) => (lng === undefined ? [] : [lng]));
  const latitudes = coordinates.flatMap(([, lat]) => (lat === undefined ? [] : [lat]));
  if (longitudes.length === 0 || latitudes.length === 0) return world;
  return {
    bounds: [
      [Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)],
    ],
    fitBoundsOptions: fit,
  };
}
