import { uniq } from "lodash-es";

// The reverse geocoder's answer, stored as it came (Photo.geolocation_json)
type GeolocatedPhoto = Readonly<{ geolocation_json?: unknown }>;

// Array.isArray on its own leaves the items unchecked; here they stay unknown until each is read
const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

function geocodeFeatures(geolocation: unknown): unknown[] {
  if (typeof geolocation === "object" && geolocation !== null && "features" in geolocation) {
    return isUnknownArray(geolocation.features) ? geolocation.features : [];
  }
  return [];
}

function featureText(feature: unknown): string {
  if (typeof feature === "object" && feature !== null && "text" in feature && typeof feature.text === "string") {
    return feature.text;
  }
  return "";
}

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
        const features = geocodeFeatures(photo.geolocation_json);
        return featureText(features[Math.max(features.length - 3, 0)]);
      })
      .filter(Boolean)
  );
}
