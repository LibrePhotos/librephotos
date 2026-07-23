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

// Stack types for organizational grouping
// NOTE: visual_duplicate and exact_copy are handled by the Duplicate model, not PhotoStack
// NOTE: RAW+JPEG pairs and Live Photos now use file_variants instead of stacks
export const StackTypeEnum = z.enum(["burst", "bracket", "manual"]);
export type StackTypeEnum = z.infer<typeof StackTypeEnum>;

// File variant types (PhotoPrism-like model)
// Same capture moment stored as different file formats
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

// Stack summary for timeline/album views
export const PhotoStackSummary = z.object({
  id: z.string().uuid(),
  type: StackTypeEnum,
  photo_count: z.number(),
  is_primary: z.boolean(),
});
export type PhotoStackSummary = z.infer<typeof PhotoStackSummary>;

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
  // Stack info (if photo is part of any stacks - can be multiple)
  stacks: PhotoStackSummary.array().nullable().optional(),
  // Flag indicating if this photo has a RAW file variant (PhotoPrism-like model)
  has_raw_variant: z.boolean().optional().default(false),
});
export type PigPhoto = z.infer<typeof PigPhoto>;

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
}

export const SharedFromMePhoto = z.object({
  user_id: z.number(),
  user: SimpleUser,
  photo: PigPhoto,
});

export const PhotoHash = z.object({
  image_hash: z.string(),
  video: z.boolean(),
});

export const People = z.object({
  name: z.string(),
  type: z.string(),
  probability: z.number(),
  location: z.object({ top: z.number(), bottom: z.number(), left: z.number(), right: z.number() }),
  face_url: z.string(),
  face_id: z.number(),
});

// Detailed stack photo info for detail view
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

// Detailed stack info for photo detail view
// Stacks are for organizational purposes (RAW+JPEG pairs, bursts, brackets, live photos, manual)
// NOTE: Duplicates (exact copies, visual duplicates) are handled separately via the Duplicate model
export const PhotoStackDetail = z.object({
  id: z.string().uuid(),
  type: StackTypeEnum,
  type_display: z.string(),
  photo_count: z.number(),
  is_primary: z.boolean(),
  photos: StackPhotoDetail.array(),
});
export type PhotoStackDetail = z.infer<typeof PhotoStackDetail>;

// Photo Metadata types - structured EXIF/XMP data with edit history support

export const MetadataSourceEnum = z.enum(["embedded", "sidecar", "user_edit", "computed"]);
export type MetadataSourceEnum = z.infer<typeof MetadataSourceEnum>;

// Summary metadata included in Photo response
export const PhotoMetadataSummary = z.object({
  // Camera info
  camera_display: z.string().nullable(),
  lens_display: z.string().nullable(),
  // Capture settings
  aperture: z.number().nullable(),
  shutter_speed: z.string().nullable(),
  iso: z.number().nullable(),
  focal_length: z.number().nullable(),
  focal_length_35mm: z.number().nullable(),
  // Image info
  resolution: z.string().nullable(),
  megapixels: z.number().nullable(),
  // Date/location
  date_taken: z.string().nullable(),
  has_location: z.boolean(),
  // Content
  rating: z.number().nullable(),
  // Edit tracking
  source: MetadataSourceEnum,
  version: z.number(),
  has_edits: z.boolean(),
});
export type PhotoMetadataSummary = z.infer<typeof PhotoMetadataSummary>;

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
  shared_to: z.number().nullable().array(), // TODO: There are sometimes items in the array with value null. Why?!?
  similar_photos: z.object({ image_hash: z.string(), type: z.nativeEnum(Media) }).array(),
  video: z.boolean(),
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
  // File variants (RAW, JPEG, video for Live Photos, etc.) - PhotoPrism-like model
  // Same capture moment stored as different file formats
  file_variants: FileVariant.array().nullable().optional(),
  // Stack info (bursts, brackets, manual) - can belong to multiple stacks
  // NOTE: RAW+JPEG and Live Photos now use file_variants, not stacks
  // NOTE: Duplicates are handled separately via the Duplicate model
  stacks: PhotoStackDetail.array().nullable().optional(),
  // Structured metadata with edit history support
  metadata: z
    .lazy(() => PhotoMetadataSummary)
    .nullable()
    .optional(),
});
export type Photo = z.infer<typeof Photo>;

// Metadata edit history entry — mirrors MetadataEditSerializer.
// `id` is a UUID string: MetadataEdit uses a UUIDField primary key.
export const MetadataEdit = z.object({
  id: z.string().uuid(),
  field_name: z.string(),
  old_value: z.any(),
  new_value: z.any(),
  user: z.number(),
  user_name: z.string(),
  synced_to_file: z.boolean(),
  synced_at: z.string().nullable(),
  created_at: z.string(),
});
export type MetadataEdit = z.infer<typeof MetadataEdit>;

export const MetadataFileTypeEnum = z.enum(["xmp", "json", "exif", "other"]);
export type MetadataFileTypeEnum = z.infer<typeof MetadataFileTypeEnum>;

export const MetadataFileSourceEnum = z.enum(["original", "software", "librephotos", "user"]);
export type MetadataFileSourceEnum = z.infer<typeof MetadataFileSourceEnum>;

// XMP sidecar file info — mirrors MetadataFileSerializer.
// `id` is a UUID string: MetadataFile uses a UUIDField primary key.
export const MetadataFile = z.object({
  id: z.string().uuid(),
  file_type: MetadataFileTypeEnum,
  source: MetadataFileSourceEnum,
  priority: z.number(),
  creator_software: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MetadataFile = z.infer<typeof MetadataFile>;

// Full metadata response from /api/photos/{id}/metadata/
//
// Mirrors PhotoMetadataSerializer.Meta.fields exactly — keep the two in sync.
// Notably the serializer does NOT emit `photo_id` (the photo is addressed by the
// URL), nor `has_edits` (that lives only on PhotoMetadataSummarySerializer);
// use `edit_history` to tell whether a photo has been edited.
export const PhotoMetadata = z.object({
  // PhotoMetadata uses a UUIDField primary key, so this is a string.
  id: z.string().uuid(),
  // Capture settings
  aperture: z.number().nullable(),
  shutter_speed: z.string().nullable(),
  shutter_speed_seconds: z.number().nullable(),
  iso: z.number().nullable(),
  focal_length: z.number().nullable(),
  focal_length_35mm: z.number().nullable(),
  exposure_compensation: z.number().nullable(),
  flash_fired: z.boolean().nullable(),
  metering_mode: z.string().nullable(),
  white_balance: z.string().nullable(),
  // Camera/lens info
  camera_make: z.string().nullable(),
  camera_model: z.string().nullable(),
  lens_make: z.string().nullable(),
  lens_model: z.string().nullable(),
  serial_number: z.string().nullable(),
  camera_display: z.string().nullable(),
  lens_display: z.string().nullable(),
  // Image properties
  width: z.number().nullable(),
  height: z.number().nullable(),
  orientation: z.number().nullable(),
  color_space: z.string().nullable(),
  bit_depth: z.number().nullable(),
  resolution: z.string().nullable(),
  megapixels: z.number().nullable(),
  // Timestamps
  date_taken: z.string().nullable(),
  date_taken_subsec: z.string().nullable(),
  date_modified: z.string().nullable(),
  timezone_offset: z.string().nullable(),
  // Location
  gps_latitude: z.number().nullable(),
  gps_longitude: z.number().nullable(),
  gps_altitude: z.number().nullable(),
  location_country: z.string().nullable(),
  location_state: z.string().nullable(),
  location_city: z.string().nullable(),
  location_address: z.string().nullable(),
  has_location: z.boolean(),
  // Content
  title: z.string().nullable(),
  caption: z.string().nullable(),
  // keywords is a nullable JSONField holding a list of strings
  keywords: z.string().array().nullable(),
  rating: z.number().nullable(),
  copyright: z.string().nullable(),
  creator: z.string().nullable(),
  // Tracking
  source: MetadataSourceEnum,
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  // Related
  edit_history: MetadataEdit.array(),
  sidecar_files: MetadataFile.array(),
});
export type PhotoMetadata = z.infer<typeof PhotoMetadata>;

// History response
export const MetadataHistoryResponse = z.object({
  results: MetadataEdit.array(),
  count: z.number(),
  page: z.number(),
  page_size: z.number(),
});
export type MetadataHistoryResponse = z.infer<typeof MetadataHistoryResponse>;

export const DatePhotosGroup = z.object({
  date: z.string().nullable(),
  year: z.number().nullable().optional(),
  month: z.number().nullable().optional(),
  location: z.string().nullable(),
  items: PigPhoto.array(),
});
export type DatePhotosGroup = z.infer<typeof DatePhotosGroup>;

export const IncompleteDatePhotosGroup = DatePhotosGroup.extend({
  id: z.string(),
  incomplete: z.boolean(),
  numberOfItems: z.number(),
});
export type IncompleteDatePhotosGroup = z.infer<typeof IncompleteDatePhotosGroup>;

// Bulk selection types for server-side "Select All" operations
export const BulkPhotoQuery = z.object({
  favorite: z.boolean().optional(),
  public: z.boolean().optional(),
  hidden: z.boolean().optional(),
  in_trashcan: z.boolean().optional(),
  video: z.boolean().optional(),
  photo: z.boolean().optional(),
  person: z.number().optional(),
  folder: z.string().optional(),
  username: z.string().optional(),
});
export type BulkPhotoQuery = z.infer<typeof BulkPhotoQuery>;

// Selection state for photolist components
export type SelectionState = {
  selectedItems: PigPhoto[];
  selectMode: boolean;
  // Server-side select all support
  selectAllMode: boolean;
  selectAllQuery?: BulkPhotoQuery;
  // Total count of photos for display in select all mode
  totalCount?: number;
};
