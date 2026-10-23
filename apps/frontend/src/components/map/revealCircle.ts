import { boxAround, type LatLon } from "../places/placeGeometry";

/** The part of a MapLibre map (react-map-gl's MapRef) that zooms in on a circle. */
export type FitMap = {
  getZoom(): number;
  fitBounds(box: [[number, number], [number, number]]): unknown;
};

// A circle this few pixels across is too small to see or drag: picking its centre zooms in
const MIN_CIRCLE_RADIUS_PX = 30;

/** Whether a circle of `radiusM` at `center` would be too small to draw on at `zoom`. */
export function circleTooSmall(center: LatLon, radiusM: number, zoom: number): boolean {
  // The metres a pixel spans at that latitude and zoom (512 px tiles, as MapLibre's)
  const metresPerPixel = (78271.517 * Math.cos((center.lat * Math.PI) / 180)) / 2 ** zoom;
  return radiusM / metresPerPixel < MIN_CIRCLE_RADIUS_PX;
}

/** Zooms `map` in on a place's circle (#1365) when it would be too small to draw on. */
export function revealCircle(map: FitMap, center: LatLon, radiusM: number): void {
  if (!circleTooSmall(center, radiusM, map.getZoom())) return;
  map.fitBounds(boxAround({ center_lat: center.lat, center_lon: center.lon, radius_m: radiusM * 2 }));
}
