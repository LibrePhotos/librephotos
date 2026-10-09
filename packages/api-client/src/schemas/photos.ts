import { z } from "zod";
import { Media, PigPhoto, SimpleUser, StackTypeEnum } from "./common";

export const People = z.object({
  name: z.string(),
  type: z.string(),
  probability: z.number(),
  location: z.object({ top: z.number(), bottom: z.number(), left: z.number(), right: z.number() }),
  face_url: z.string(),
  face_id: z.number(),
});
export type People = z.infer<typeof People>;

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
  id: z.string().uuid(),
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
  id: z.string().uuid(),
  type: StackTypeEnum,
  type_display: z.string(),
  photo_count: z.number(),
  is_primary: z.boolean(),
  photos: StackPhotoDetail.array(),
});
export type PhotoStackDetail = z.infer<typeof PhotoStackDetail>;

/** Full photo-detail response from GET /api/photos/{hash}/. */
export const Photo = z.object({
  id: z.string().uuid(),
  camera: z.string().nullable(),
  exif_gps_lat: z.number().nullable(),
  exif_gps_lon: z.number().nullable(),
  exif_timestamp: z.string().nullable(),
  search_captions: z.string().nullable(),
  search_location: z.string().nullable(),
  captions_json: z.any().nullable(),
  big_thumbnail_url: z.string().nullable(),
  small_square_thumbnail_url: z.string().nullable(),
  geolocation_json: z.any().nullable(),
  exif_json: z.any().nullable(),
  people: People.array(),
  image_hash: z.string(),
  image_path: z.string().array(),
  rating: z.number(),
  hidden: z.boolean(),
  public: z.boolean(),
  in_trashcan: z.boolean(),
  removed: z.boolean(),
  size: z.number(),
  shared_to: z.number().nullable().array(),
  similar_photos: z.object({ image_hash: z.string(), type: z.nativeEnum(Media) }).array(),
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
  embedded_media: z.object({ id: z.string(), type: z.nativeEnum(Media) }).array(),
  file_variants: FileVariant.array().nullable().optional(),
  stacks: PhotoStackDetail.array().nullable().optional(),
  metadata: PhotoMetadataSummary.nullable().optional(),
  ocr: PhotoOcrData.nullable().optional(),
  // What a video is, as HTMLMediaElement.canPlayType() takes it; null until
  // the scan has probed the video, and for anything that is not one.
  video_playback_type: z.string().nullable().optional(),
});
export type Photo = z.infer<typeof Photo>;

export const RecentlyAddedPhotosResponse = z.object({
  results: PigPhoto.array(),
  date: z.string(),
});
export type RecentlyAddedPhotosResponse = z.infer<typeof RecentlyAddedPhotosResponse>;

/** GET /api/photos/notimestamp/: DRF page-number pagination, 100 per page. */
export const PhotosWithoutTimestampResponse = z.object({
  results: PigPhoto.array(),
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
});
export type PhotosWithoutTimestampResponse = z.infer<typeof PhotosWithoutTimestampResponse>;

/** Body describing a photoset for server-side "select all" bulk operations. */
export const BulkPhotoQuery = z.object({
  favorite: z.boolean().optional(),
  public: z.boolean().optional(),
  hidden: z.boolean().optional(),
  in_trashcan: z.boolean().optional(),
  video: z.boolean().optional(),
  photo: z.boolean().optional(),
  // true: only screenshots / documents; false: none of them.
  is_screenshot: z.boolean().optional(),
  is_document: z.boolean().optional(),
  // The timeline filter, as the timeline sends it (see api/timeline_filter.py).
  media: z.enum(["all", "photos", "videos"]).optional(),
  hide_screenshots: z.boolean().optional(),
  hide_documents: z.boolean().optional(),
  person: z.number().optional(),
  folder: z.string().optional(),
  username: z.string().optional(),
});
export type BulkPhotoQuery = z.infer<typeof BulkPhotoQuery>;
