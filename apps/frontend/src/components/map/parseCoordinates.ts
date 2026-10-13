/** What the location search box holds when it is a pasted "lat, lon" rather than a place name. */
export type TypedCoordinates = { kind: "position"; lat: number; lon: number } | { kind: "out_of_range" };

// Two decimal numbers separated by a comma and/or spaces: "48.8566, 2.3522", "48.8566 2.3522".
const COORDINATES = /^\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*|\s+)(-?\d+(?:\.\d+)?)\s*$/;

/** The coordinates in `text`, `out_of_range` for numbers off the globe, null for anything else. */
export function parseCoordinates(text: string): TypedCoordinates | null {
  const match = COORDINATES.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { kind: "out_of_range" };
  return { kind: "position", lat, lon };
}
