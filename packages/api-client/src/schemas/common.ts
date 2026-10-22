import { z } from "zod";

/**
 * A dashed, 36-character UUID of any version. zod 4's `z.uuid()` accepts only
 * RFC 9562 version/variant bits, which is stricter than what the backend has
 * always sent (zod 3's `.uuid()` took any dashed hex UUID).
 */
export const UuidString = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "Invalid uuid");

/**
 * The fields every paginated list answers next to its `results` (backend
 * `api/drf/pagination.py`). `page`, `page_size` and `num_pages` are optional:
 * servers before 1.4 (#2327) do not send them. Read a whole list with
 * `fetchAllPages`, which follows `next`.
 */
export const PageFields = {
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  page: z.number().optional(),
  page_size: z.number().optional(),
  num_pages: z.number().optional(),
};

/**
 * An integer primary key. Some endpoints sent theirs as a string ("12"), others
 * as a number (issue #389); this reads both and always gives a number, so ids
 * from different responses compare and key alike. Use it for every id a server
 * has ever sent as a string: a client must keep reading an older server.
 * The contract test (openapi-contract.ts) recognises it by its `x-id` mark.
 */
export const IntegerId = z
  .union([z.number().int(), z.string().regex(/^\d+$/, "Invalid id").transform(Number)])
  .meta({ "x-id": true });

/**
 * A flag a hand-built view computes as `<object> and <comparison>` in Python, which is null
 * (not false) when the object is missing: a stack without a primary photo, a duplicate group
 * with no kept photo yet, a photo without a main file. Read as false.
 */
export const MaybeFlag = z
  .boolean()
  .nullable()
  .transform(value => value === true);

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

// RAW + JPEG pairs and Live Photos are file variants now, but migration 0112 left
// the stacks it could not convert, and photo lists and details still return them.
// Without them here one such photo fails the parse of its whole page.
export const StackTypeEnum = z.enum(["burst", "bracket", "manual", "raw_jpeg", "live_photo"]);
export type StackTypeEnum = z.infer<typeof StackTypeEnum>;

export const PhotoStackSummary = z.object({
  id: UuidString,
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
 * A photo's `projection_type` when it is a 360° photo sphere (#483): GPano's
 * name for the projection, as the backend stores it (`api.metadata.projection`).
 */
export const EQUIRECTANGULAR_PROJECTION = "equirectangular";

/**
 * A photo's projection: `EQUIRECTANGULAR_PROJECTION` for a photo sphere, null for a flat photo.
 * Optional: backends before 1.5 do not send it, and know no spheres.
 */
export const ProjectionType = z.string().nullish();

/**
 * The lightweight photo shape returned by list/timeline endpoints ("pig" =
 * photo-in-grid). `image_hash` names its thumbnails and media files.
 */
export const PigPhoto = z.object({
  id: UuidString,
  image_hash: z.string(),
  dominantColor: z.string().optional(),
  // Legacy: the backend still sends the image hash here; read `image_hash`.
  url: z.string().optional(),
  location: z.string().optional(),
  date: z.string().optional().nullable(),
  birthTime: z.string().optional(),
  aspectRatio: z.number(),
  type: z.enum(Media).default(Media.IMAGE),
  video_length: z.string().optional(),
  // An HDR (PQ or HLG) video, for the badge on its tile. Absent from backends
  // that predate it, where no video is flagged.
  is_hdr: z.boolean().optional().default(false),
  // Whether a video's grid square is an animated clip (true) or a still frame, scanned with the
  // animated previews off (#649). Absent from older backends, where every video square is a clip.
  animated_preview: z.boolean().optional(),
  // A video with a still poster beside its clip (#2026): the grid shows it and plays the clip only
  // while the tile is pointed at. Absent from older backends; false until the poster job has run.
  video_poster: z.boolean().optional(),
  rating: z.number().default(0),
  owner: SimpleUser.optional(),
  shared_to: SimpleUser.array().default([]),
  isTemp: z.boolean().default(false),
  exif_gps_lat: z.number().nullable().optional(),
  exif_gps_lon: z.number().nullable().optional(),
  removed: z.boolean().optional(),
  in_trashcan: z.boolean().optional(),
  // Archived (#545): off the timeline and Memories, still everywhere else; the tile shows a mark.
  // Absent from older backends, which have no archive.
  archived: z.boolean().optional(),
  // When the photo went to the trash (ISO date-time), null outside it (#2203).
  // Optional: older backends do not send it.
  trashed_at: z.string().nullable().optional(),
  stacks: PhotoStackSummary.array().nullable().optional(),
  has_raw_variant: z.boolean().optional().default(false),
  // The user's rotation (1 = none; numbered like EXIF Orientation, but 6
  // and 8 render swapped, #2595). Optional:
  // backends before 1.3 do not send it.
  local_orientation: z.number().optional(),
  // A 360° photo sphere gets a badge on its tile (#483).
  projection_type: ProjectionType,
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
  id: IntegerId,
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
  ARCHIVED = "archived",
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
  DOCUMENTS = "documents",
}

/** The image hash of a PigPhoto. Kept for callers that predate `image_hash` on every photo. */
export function imageHashOf(photo: Pick<PigPhoto, "image_hash">): string {
  return photo.image_hash;
}
