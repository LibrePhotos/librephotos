import { z } from "zod";
import { UuidString } from "./common";

/**
 * `POST /photosedit/location/` (#2279): the selected photos moved to one spot. `count` is the photos
 * that got it, `skipped_with_location` those left alone because they have a location (`overwrite`
 * false), and `geocoded` false when the spot has no place name (the coordinates are kept).
 */
export const SetPhotosLocationResponse = z.object({
  count: z.number(),
  skipped_with_location: z.number(),
  geocoded: z.boolean(),
});
export type SetPhotosLocationResponse = z.infer<typeof SetPhotosLocationResponse>;

/** A place name of a selection and how many of its photos have it. */
export const PlaceCount = z.object({
  place: z.string(),
  count: z.number(),
});
export type PlaceCount = z.infer<typeof PlaceCount>;

/**
 * `POST /photos/location-summary/`: how many photos the selection has, how many of them have a
 * location, their most frequent place names, and when the first and the last were taken.
 */
export const LocationSummaryResponse = z.object({
  count: z.number(),
  with_location: z.number(),
  places: PlaceCount.array(),
  first_taken: z.string().nullable(),
  last_taken: z.string().nullable(),
});
export type LocationSummaryResponse = z.infer<typeof LocationSummaryResponse>;

/** One geotagged photo the location picker offers to copy a location from. */
export const LocatedPhoto = z.object({
  id: UuidString,
  image_hash: z.string(),
  exif_timestamp: z.string().nullable(),
  exif_gps_lat: z.number().nullable(),
  exif_gps_lon: z.number().nullable(),
  // The photo's place name; null or "" without one.
  place: z.string().nullable(),
  // Its town or region, for a small label; null without a place.
  short_place: z.string().nullable(),
});
export type LocatedPhoto = z.infer<typeof LocatedPhoto>;

/** `GET /photos/located-nearby-in-time/?from=&to=`: at most 20, nearest to the window's middle first. */
export const LocatedPhotosResponse = LocatedPhoto.array();
export type LocatedPhotosResponse = z.infer<typeof LocatedPhotosResponse>;
