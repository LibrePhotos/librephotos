import { z } from "zod";

export const SimpleUser = z.object({
  id: z.number(),
  username: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});
export type SimpleUser = z.infer<typeof SimpleUser>;

export enum Media {
  IMAGE = "image",
  VIDEO = "video",
  MOTION_PHOTO = "motion_photo",
}

export const StackTypeEnum = z.enum(["burst", "bracket", "manual"]);
export type StackTypeEnum = z.infer<typeof StackTypeEnum>;

export const PhotoStackSummary = z.object({
  id: z.string().uuid(),
  type: StackTypeEnum,
  photo_count: z.number(),
  is_primary: z.boolean(),
});
export type PhotoStackSummary = z.infer<typeof PhotoStackSummary>;

export const PhotoHash = z.object({
  image_hash: z.string(),
  video: z.boolean(),
});
export type PhotoHash = z.infer<typeof PhotoHash>;

/**
 * The lightweight photo shape returned by list/timeline endpoints ("pig" =
 * photo-in-grid). `url` is a `;`-delimited string whose first segment is the
 * image hash; use `imageHashOf()` to extract it.
 */
export const PigPhoto = z.object({
  id: z.string().uuid(),
  image_hash: z.string(),
  dominantColor: z.string().optional(),
  url: z.string().optional(),
  location: z.string().optional(),
  date: z.string().optional().nullable(),
  birthTime: z.string().optional(),
  aspectRatio: z.number(),
  type: z.nativeEnum(Media).default(Media.IMAGE),
  video_length: z.string().optional(),
  rating: z.number().default(0),
  owner: SimpleUser.optional(),
  shared_to: SimpleUser.array().default([]),
  isTemp: z.boolean().default(false),
  exif_gps_lat: z.number().nullable().optional(),
  exif_gps_lon: z.number().nullable().optional(),
  removed: z.boolean().optional(),
  in_trashcan: z.boolean().optional(),
  stacks: PhotoStackSummary.array().nullable().optional(),
  has_raw_variant: z.boolean().optional().default(false),
});
export type PigPhoto = z.infer<typeof PigPhoto>;

export const DatePhotosGroup = z.object({
  date: z.string().nullable(),
  year: z.number().nullable().optional(),
  month: z.number().nullable().optional(),
  location: z.string().nullable(),
  items: PigPhoto.array(),
});
export type DatePhotosGroup = z.infer<typeof DatePhotosGroup>;

/** A date group as returned by the paginated date-album list (with cursor id + lazy items). */
export const IncompleteDatePhotosGroup = DatePhotosGroup.extend({
  id: z.string(),
  incomplete: z.boolean(),
  numberOfItems: z.number(),
});
export type IncompleteDatePhotosGroup = z.infer<typeof IncompleteDatePhotosGroup>;

/** Which timeline surface / photoset a screen is showing. */
export enum Photoset {
  NONE = "none",
  TIMESTAMP = "timestamp",
  NO_TIMESTAMP = "noTimestamp",
  FAVORITES = "favorites",
  PHOTOS = "photos",
  HIDDEN = "hidden",
  RECENTLY_ADDED = "recentlyAdded",
  IN_TRASHCAN = "in_trashcan",
  SEARCH = "search",
  USER_ALBUM = "userAlbum",
  PERSON = "person",
  PUBLIC = "public",
  SHARED_TO_ME = "sharedToMe",
  SHARED_BY_ME = "sharedByMe",
  VIDEOS = "videos",
  SCREENSHOTS = "screenshots",
}

/** Extract the image hash from a PigPhoto (handles the `;`-delimited `url`). */
export function imageHashOf(photo: Pick<PigPhoto, "image_hash" | "url">): string {
  if (photo.url) {
    const first = photo.url.split(";")[0];
    if (first) return first;
  }
  return photo.image_hash;
}
