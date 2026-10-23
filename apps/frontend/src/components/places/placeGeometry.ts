import type { Feature, FeatureCollection, Polygon } from "geojson";

/** A position in degrees. */
export type LatLon = Readonly<{ lat: number; lon: number }>;

/** A circle a place is drawn as. */
export type Circle = Readonly<{ center: LatLon; radiusM: number }>;

/** The mean radius of the Earth in metres, as the server's `api/places/geometry.py`. */
const EARTH_RADIUS_M = 6_371_008.8;

/** How small and how large a place can be drawn, as the server allows. */
export const RADIUS_LIMITS = { min: 25, max: 2000 } as const;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** The great-circle distance between two positions, in metres (haversine, as the server). */
export function distanceM(a: LatLon, b: LatLon): number {
  const phi1 = toRadians(a.lat);
  const phi2 = toRadians(b.lat);
  const dPhi = phi2 - phi1;
  const dLambda = toRadians(b.lon - a.lon);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The position `distance` metres from `from` in the direction `bearing` (degrees from north). */
export function destination(from: LatLon, distance: number, bearing: number): LatLon {
  const delta = distance / EARTH_RADIUS_M;
  const theta = toRadians(bearing);
  const phi1 = toRadians(from.lat);
  const lambda1 = toRadians(from.lon);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: toDegrees(phi2), lon: ((toDegrees(lambda2) + 540) % 360) - 180 };
}

// Corners of the polygon a circle is drawn as: smooth at any zoom a place makes sense at.
const CIRCLE_STEPS = 64;

/** A circle as a GeoJSON polygon, for the map's fill and outline layers. */
export function circlePolygon({ center, radiusM }: Circle): Polygon {
  const ring = Array.from({ length: CIRCLE_STEPS + 1 }, (_, step) => {
    const corner = destination(center, radiusM, (step * 360) / CIRCLE_STEPS);
    return [corner.lon, corner.lat];
  });
  return { type: "Polygon", coordinates: [ring] };
}

/** Circles as one GeoJSON source; each feature carries `id` and whether it is the one `active`. */
export function circleCollection(
  circles: readonly (Circle & { id: number })[],
  activeId: number | null = null
): FeatureCollection<Polygon, { id: number; active: boolean }> {
  const features: Feature<Polygon, { id: number; active: boolean }>[] = circles.map(circle => ({
    type: "Feature",
    properties: { id: circle.id, active: circle.id === activeId },
    geometry: circlePolygon(circle),
  }));
  return { type: "FeatureCollection", features };
}

// The editor rounds a dragged radius to this many metres.
const RADIUS_STEP = 5;

/** The radius a drag of the edge to `edge` asks for: rounded, within the limits. */
export function radiusTo(center: LatLon, edge: LatLon): number {
  const rounded = Math.round(distanceM(center, edge) / RADIUS_STEP) * RADIUS_STEP;
  return Math.min(RADIUS_LIMITS.max, Math.max(RADIUS_LIMITS.min, rounded));
}

/** Where the edge handle of a circle sits: due east of its centre. */
export function edgeOf({ center, radiusM }: Circle): LatLon {
  return destination(center, radiusM, 90);
}

/**
 * The place a position is in: the smallest whose circle holds it, as the server files photos
 * (`api/places/membership.py`); undefined for none.
 */
export function placeAt<P extends Readonly<{ center_lat: number; center_lon: number; radius_m: number }>>(
  places: readonly P[],
  position: LatLon
): P | undefined {
  return [...places]
    .sort((a, b) => a.radius_m - b.radius_m)
    .find(place => distanceM({ lat: place.center_lat, lon: place.center_lon }, position) <= place.radius_m);
}

/** The box around a place and half its radius more, as `[[west, south], [east, north]]` for the map to show. */
export function boxAround(
  place: Readonly<{ center_lat: number; center_lon: number; radius_m: number }>
): [[number, number], [number, number]] {
  const center = { lat: place.center_lat, lon: place.center_lon };
  const reach = place.radius_m * 1.5;
  return [
    [destination(center, reach, 270).lon, destination(center, reach, 180).lat],
    [destination(center, reach, 90).lon, destination(center, reach, 0).lat],
  ];
}
