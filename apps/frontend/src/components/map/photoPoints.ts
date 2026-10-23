import type { MapBounds } from "@librephotos/api-client";
import type { FeatureCollection, Point } from "geojson";

/** What each photo point carries: how many photos were taken there. Clusters sum it. */
export type PhotoPointProperties = Readonly<{ photos: number }>;

/**
 * The photo points of `GET /photos/map-points/` (`[lat, lon, photos]` rows) as a GeoJSON source.
 * A row of another shape is left out.
 */
export function photoPointCollection(
  points: readonly (readonly number[])[] | undefined
): FeatureCollection<Point, PhotoPointProperties> {
  const features = (points ?? []).flatMap(([lat, lon, photos]) =>
    lat === undefined || lon === undefined || photos === undefined
      ? []
      : [
          {
            type: "Feature" as const,
            properties: { photos },
            geometry: { type: "Point" as const, coordinates: [lon, lat] },
          },
        ]
  );
  return { type: "FeatureCollection", features };
}

/** The part of a MapLibre LngLatBounds the Places map reads. */
type ViewBounds = Readonly<{
  getSouth: () => number;
  getWest: () => number;
  getNorth: () => number;
  getEast: () => number;
}>;

// Decimal places of a view's edges: a pan of under ten metres asks nothing new.
const EDGE_DECIMALS = 4;

function round(value: number): number {
  const factor = 10 ** EDGE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** A longitude brought into -180..180, for a map that has been panned round the world. */
function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function clampLatitude(lat: number): number {
  return Math.min(90, Math.max(-90, lat));
}

/**
 * A map's view as the server's bounds: latitudes clamped, longitudes wrapped into -180..180 (west
 * greater than east then crosses the 180th meridian), and a view as wide as the world all of it.
 */
export function mapBoundsOf(view: ViewBounds): MapBounds {
  const south = round(clampLatitude(view.getSouth()));
  const north = round(clampLatitude(view.getNorth()));
  const west = view.getWest();
  const east = view.getEast();
  if (east - west >= 360) return { south, west: -180, north, east: 180 };
  return { south, west: round(wrapLongitude(west)), north, east: round(wrapLongitude(east)) };
}

// About a metre: the server rounds photo positions to five decimal places.
const POINT_MARGIN = 0.00002;

/** The bounds around some `[lng, lat]` positions, with a metre or so to spare for the rounding. */
export function boundsAround(coordinates: readonly (readonly number[])[]): MapBounds | null {
  const lngs = coordinates.flatMap(([lng]) => (lng === undefined ? [] : [lng]));
  const lats = coordinates.flatMap(([, lat]) => (lat === undefined ? [] : [lat]));
  if (lngs.length === 0 || lats.length === 0) return null;
  return {
    south: clampLatitude(Math.min(...lats) - POINT_MARGIN),
    west: Math.max(-180, Math.min(...lngs) - POINT_MARGIN),
    north: clampLatitude(Math.max(...lats) + POINT_MARGIN),
    east: Math.min(180, Math.max(...lngs) + POINT_MARGIN),
  };
}
