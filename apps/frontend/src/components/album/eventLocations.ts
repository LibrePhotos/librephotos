import { uniq } from "lodash-es";

type GeolocatedPhoto = Readonly<{ geolocation_json?: { features?: { text?: string }[] } | null }>;

/**
 * The place names an event's photos were taken at, in the order of the photos,
 * for its "<place> on map" button.
 *
 * A geocode lists one feature per address part it found, broadest last, and the
 * third from the end is the town-level name. Some have fewer parts (a summit,
 * the sea: just state and country), some none at all, and some photos were
 * never geocoded; those used to throw and take the whole event page down.
 */
export function eventLocationNames(photos: readonly GeolocatedPhoto[]): string[] {
  return uniq(
    photos
      .map(photo => {
        const features = photo.geolocation_json?.features ?? [];
        return features[Math.max(features.length - 3, 0)]?.text ?? "";
      })
      .filter(Boolean)
  );
}
