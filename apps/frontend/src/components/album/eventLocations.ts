import { uniq } from "lodash-es";

// The reverse geocoder's answer, stored as it came (Photo.geolocation_json)
type GeolocatedPhoto = Readonly<{ geolocation_json?: unknown }>;

// The levels a geocode names, finest first, as api.models.place_names in the backend ranks them:
// a missing level falls back to the nearest finer one, then the nearest coarser one. Streets and
// POIs are never a place name of a level.
const RANKED_LEVELS = ["locality", "city", "subregion", "region", "country"] as const;
type RankedLevel = (typeof RANKED_LEVELS)[number];

// Mapbox's own feature types, which older Mapbox geocodes carry as their place_type list.
const LEVEL_ALIASES: Readonly<Record<string, RankedLevel>> = {
  neighborhood: "locality",
  place: "city",
  district: "subregion",
};

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

// Older Mapbox geocodes list several types (Berlin is ["region", "place"]); the finest one counts.
function featureLevel(feature: unknown): RankedLevel | null {
  if (typeof feature !== "object" || feature === null || !("place_type" in feature)) return null;
  const types: unknown[] = isUnknownArray(feature.place_type) ? feature.place_type : [feature.place_type];
  const levels = types.flatMap(type => (typeof type === "string" ? [LEVEL_ALIASES[type] ?? type] : []));
  return RANKED_LEVELS.find(level => levels.includes(level)) ?? null;
}

/** The first name of each level the features are typed with (#2302). */
function typedNames(features: readonly unknown[]): Partial<Record<RankedLevel, string>> {
  const names: Partial<Record<RankedLevel, string>> = {};
  for (const feature of features) {
    const level = featureLevel(feature);
    const text = featureText(feature);
    if (level && text && names[level] === undefined) names[level] = text;
  }
  return names;
}

/** The town level, else the nearest finer level, else the nearest coarser one. */
const TOWN_SEARCH_ORDER: readonly RankedLevel[] = ["city", "locality", "subregion", "region", "country"];

/**
 * The town a photo was taken in. A geocode written since #2302 says which level each feature is,
 * and this takes the town ("Zermatt", not the region "Valais" ExifTool lists next). An older one
 * lists one feature per address part, broadest last, and the third from the end is the town.
 */
function townName(geolocation: unknown): string {
  const features = geocodeFeatures(geolocation);
  const typed = typedNames(features);
  const level = TOWN_SEARCH_ORDER.find(candidate => typed[candidate] !== undefined);
  if (level) return typed[level] ?? "";
  return featureText(features[Math.max(features.length - 3, 0)]);
}

/**
 * The place names an event's photos were taken at, in the order of the photos,
 * for its "<place> on map" button.
 *
 * Some geocodes have fewer parts (a summit, the sea: just state and country), some none at all,
 * and some photos were never geocoded; those used to throw and take the whole event page down.
 */
export function eventLocationNames(photos: readonly GeolocatedPhoto[]): string[] {
  return uniq(photos.map(photo => townName(photo.geolocation_json)).filter(Boolean));
}
