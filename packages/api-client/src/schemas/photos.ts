import { z } from "zod";
import { Media, PageFields, PigPhoto, SimpleUser, StackTypeEnum, UuidString } from "./common";
import { FileTypeFilter } from "./search";

/** One face entry in `Photo.people`: a face on this photo, with the name of its person. */
export const PhotoPerson = z.object({
  name: z.string(),
  type: z.string(),
  probability: z.number(),
  location: z.object({ top: z.number(), bottom: z.number(), left: z.number(), right: z.number() }),
  face_url: z.string(),
  face_id: z.number(),
});
export type PhotoPerson = z.infer<typeof PhotoPerson>;
/** @deprecated Use `PhotoPerson`; kept for one release while apps/mobile moves. */
export const People = PhotoPerson;
/** @deprecated Use `PhotoPerson`. */
export type People = PhotoPerson;

export const MetadataSourceEnum = z.enum(["embedded", "sidecar", "user_edit", "computed"]);
export type MetadataSourceEnum = z.infer<typeof MetadataSourceEnum>;

export const PhotoMetadataSummary = z.object({
  camera_display: z.string().nullable(),
  lens_display: z.string().nullable(),
  aperture: z.number().nullable(),
  shutter_speed: z.string().nullable(),
  iso: z.number().nullable(),
  focal_length: z.number().nullable(),
  focal_length_35mm: z.number().nullable(),
  resolution: z.string().nullable(),
  megapixels: z.number().nullable(),
  date_taken: z.string().nullable(),
  has_location: z.boolean(),
  rating: z.number().nullable(),
  source: MetadataSourceEnum,
  version: z.number(),
  has_edits: z.boolean(),
});
export type PhotoMetadataSummary = z.infer<typeof PhotoMetadataSummary>;

/** One recognized OCR block; `box` = 4 [x,y] quad corners normalized to [0,1]. */
export const PhotoOcrBlock = z.object({
  text: z.string(),
  box: z.number().array().length(2).array().length(4),
  confidence: z.number().nullable().optional(),
});
export type PhotoOcrBlock = z.infer<typeof PhotoOcrBlock>;

export const PhotoOcrData = z.object({
  text: z.string(),
  blocks: PhotoOcrBlock.array(),
});
export type PhotoOcrData = z.infer<typeof PhotoOcrData>;

/**
 * One stored file of a photo: the same capture moment as a different format
 * (RAW next to its JPEG, the video half of a Live Photo, an XMP sidecar).
 */
export const FileVariantTypeEnum = z.enum(["image", "video", "raw", "metadata", "unknown"]);
export type FileVariantTypeEnum = z.infer<typeof FileVariantTypeEnum>;

export const FileVariant = z.object({
  hash: z.string(),
  path: z.string(),
  type: FileVariantTypeEnum,
  type_id: z.number(),
  is_main: z.boolean(),
  filename: z.string().nullable(),
});
export type FileVariant = z.infer<typeof FileVariant>;

/** One member photo of a stack, as listed on the photo detail. */
export const StackPhotoDetail = z.object({
  id: UuidString,
  image_hash: z.string(),
  is_primary: z.boolean(),
  thumbnail_url: z.string().nullable(),
  size: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type StackPhotoDetail = z.infer<typeof StackPhotoDetail>;

/**
 * A stack (burst, bracket, manual) the photo belongs to. Duplicates are a
 * separate model, and RAW+JPEG pairs / Live Photos are file variants.
 */
export const PhotoStackDetail = z.object({
  id: UuidString,
  type: StackTypeEnum,
  type_display: z.string(),
  photo_count: z.number(),
  is_primary: z.boolean(),
  photos: StackPhotoDetail.array(),
});
export type PhotoStackDetail = z.infer<typeof PhotoStackDetail>;

/** Full photo-detail response from GET /api/photos/{hash}/. */
export const Photo = z.object({
  id: UuidString,
  camera: z.string().nullable(),
  exif_gps_lat: z.number().nullable(),
  exif_gps_lon: z.number().nullable(),
  exif_timestamp: z.string().nullable(),
  // Whether exif_timestamp was set by hand; it then wins over the date rules
  // (#2254). Optional: backends before 1.4 do not send it.
  date_set_by_user: z.boolean().optional(),
  search_captions: z.string().nullable(),
  search_location: z.string().nullable(),
  // Never null from current servers ({"im2txt": ""} when there are no captions):
  // user_caption, im2txt, places365 and one { tags } object per tagging model.
  captions_json: z.record(z.string(), z.unknown()).nullish(),
  // "" when the thumbnail has not been made yet, never null.
  big_thumbnail_url: z.string(),
  // Optional: backends before 1.3 do not send it.
  square_thumbnail_url: z.string().optional(),
  small_square_thumbnail_url: z.string(),
  // The reverse geocoder's answer (features, places, ...), stored as it came.
  geolocation_json: z.unknown(),
  people: PhotoPerson.array(),
  image_hash: z.string(),
  image_path: z.string().array(),
  rating: z.number(),
  hidden: z.boolean(),
  // Archived (#545): off the timeline and Memories only. Older backends do not send it.
  archived: z.boolean().optional(),
  public: z.boolean(),
  in_trashcan: z.boolean(),
  // When the photo went to the trash (ISO date-time), null outside it (#2203).
  // Optional: older backends do not send it.
  trashed_at: z.string().nullable().optional(),
  removed: z.boolean(),
  size: z.number(),
  shared_to: z.number().nullable().array(),
  similar_photos: z.object({ image_hash: z.string(), type: z.enum(Media) }).array(),
  video: z.boolean(),
  is_screenshot: z.boolean().optional().default(false),
  is_document: z.boolean().optional().default(false),
  // "user" once the owner set the category; rescans then leave it alone.
  category_source: z.enum(["auto", "user"]).optional().default("auto").catch("auto"),
  owner: SimpleUser,
  shutter_speed: z.string().nullable(),
  height: z.number().nullable(),
  width: z.number().nullable(),
  fstop: z.number().nullable(),
  iso: z.number().nullable(),
  focal_length: z.number().nullable(),
  focalLength35Equivalent: z.number().nullable(),
  subjectDistance: z.number().nullable(),
  digitalZoomRatio: z.number().nullable(),
  lens: z.string().nullable(),
  // The rest of the exposure the camera recorded (#2276): EV, whether the flash
  // fired, and metering mode / white balance as ExifTool names them ("Spot",
  // "Auto"). Optional: backends before 1.4 do not send them.
  exposure_compensation: z.number().nullable().optional(),
  flash_fired: z.boolean().nullable().optional(),
  metering_mode: z.string().nullable().optional(),
  white_balance: z.string().nullable().optional(),
  // Metres above sea level (negative below it); null for anyone but the owner.
  gps_altitude: z.number().nullable().optional(),
  // A video's duration in seconds, as a string like the grid's; and its codec as
  // ffprobe names it ("h264", "hevc"; "" when the probe could not tell).
  video_length: z.string().nullable().optional(),
  video_codec: z.string().nullable().optional(),
  embedded_media: z.object({ id: z.string(), type: z.enum(Media) }).array(),
  file_variants: FileVariant.array().nullable().optional(),
  stacks: PhotoStackDetail.array().nullable().optional(),
  metadata: PhotoMetadataSummary.nullable().optional(),
  ocr: PhotoOcrData.nullable().optional(),
  // What a video is, as HTMLMediaElement.canPlayType() takes it; null until
  // the scan has probed the video, and for anything that is not one.
  video_playback_type: z.string().nullable().optional(),
  // The user's rotation (1 = none; numbered like EXIF Orientation, but 6
  // and 8 render swapped, #2595). Optional:
  // backends before 1.3 do not send it.
  local_orientation: z.number().optional(),
});
export type Photo = z.infer<typeof Photo>;

export const RecentlyAddedPhotosResponse = z.object({
  results: PigPhoto.array(),
  // When the newest photos were added; null while the user has no visible photos.
  date: z.string().nullable(),
});
export type RecentlyAddedPhotosResponse = z.infer<typeof RecentlyAddedPhotosResponse>;

/** GET /api/photos/notimestamp/: DRF page-number pagination, 100 per page. */
export const PhotosWithoutTimestampResponse = z.object({
  ...PageFields,
  results: PigPhoto.array(),
});
export type PhotosWithoutTimestampResponse = z.infer<typeof PhotosWithoutTimestampResponse>;

/** GET /api/photos/nolocation/: DRF page-number pagination, 100 per page. */
export const PhotosWithoutLocationResponse = z.object({
  ...PageFields,
  results: PigPhoto.array(),
});
export type PhotosWithoutLocationResponse = z.infer<typeof PhotosWithoutLocationResponse>;

/** GET /api/photos/no-album/: the same page of photo summaries, for the photos in none of my albums. */
export const PhotosNotInAlbumResponse = PhotosWithoutTimestampResponse;
export type PhotosNotInAlbumResponse = PhotosWithoutTimestampResponse;

/** GET /api/photos/public/: a page of my own public photos, newest first. */
export const MyPublicPhotosResponse = PhotosWithoutTimestampResponse;
export type MyPublicPhotosResponse = PhotosWithoutTimestampResponse;

/** Body describing a photoset for server-side "select all" bulk operations. */
export const BulkPhotoQuery = z.object({
  favorite: z.boolean().optional(),
  public: z.boolean().optional(),
  hidden: z.boolean().optional(),
  // true: only archived photos (the Archive page); false: none of them (the timeline).
  archived: z.boolean().optional(),
  in_trashcan: z.boolean().optional(),
  video: z.boolean().optional(),
  photo: z.boolean().optional(),
  // true: only screenshots / documents; false: none of them.
  is_screenshot: z.boolean().optional(),
  is_document: z.boolean().optional(),
  // The timeline filter, as the timeline sends it (see api/albums/timeline_filter.py).
  media: z.enum(["all", "photos", "videos"]).optional(),
  hide_screenshots: z.boolean().optional(),
  hide_documents: z.boolean().optional(),
  // One person (the person page), or a list: only photos showing every one of them.
  person: z.union([z.number(), z.array(z.number())]).optional(),
  folder: z.string().optional(),
  username: z.string().optional(),
  // Only photos without a date: the "Photos without Timestamps" page.
  no_timestamp: z.boolean().optional(),
  // Only photos in none of my own albums: the "Photos not in an album" page.
  no_album: z.boolean().optional(),
  // Only photos without GPS coordinates: the "Photos without Location" page.
  no_location: z.boolean().optional(),
  // Stacked photos too, not only each stack's primary photo (for pages that list them all).
  show_all_stack_photos: z.boolean().optional(),
  // The structured search filters (endpoints.SearchFilters), so a select-all after a filtered search
  // acts on what it listed; a bad value is a 400 on "query".
  camera: z.string().optional(),
  make: z.string().optional(),
  lens: z.string().optional(),
  iso_min: z.number().optional(),
  iso_max: z.number().optional(),
  aperture_min: z.number().optional(),
  aperture_max: z.number().optional(),
  focal_min: z.number().optional(),
  focal_max: z.number().optional(),
  focal35_min: z.number().optional(),
  focal35_max: z.number().optional(),
  rating_min: z.number().optional(),
  taken_after: z.string().optional(),
  taken_before: z.string().optional(),
  has_location: z.boolean().optional(),
  file_type: FileTypeFilter.optional(),
  extension: z.string().optional(),
});
export type BulkPhotoQuery = z.infer<typeof BulkPhotoQuery>;
