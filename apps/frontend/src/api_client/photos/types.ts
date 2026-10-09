import { BulkPhotoQuery, MetadataSourceEnum, PigPhoto, SimpleUser } from "@librephotos/api-client";
import { z } from "zod";

// The photo and photo-grid schemas are shared with the mobile app and live in
// packages/api-client; this module re-exports them under their old names.
export {
  BulkPhotoQuery,
  DatePhotosGroup,
  FileVariant,
  FileVariantTypeEnum,
  IncompleteDatePhotosGroup,
  Media,
  MetadataSourceEnum,
  People,
  Photo,
  PhotoHash,
  PhotoMetadataSummary,
  PhotoOcrBlock,
  PhotoOcrData,
  Photoset,
  PhotoStackDetail,
  PhotoStackSummary,
  PigPhoto,
  SimpleUser,
  StackPhotoDetail,
  StackTypeEnum,
} from "@librephotos/api-client";

export const SharedFromMePhoto = z.object({
  user_id: z.number(),
  user: SimpleUser,
  photo: PigPhoto,
});

// Metadata edit history entry — mirrors MetadataEditSerializer.
// `id` is a UUID string: MetadataEdit uses a UUIDField primary key.
export const MetadataEdit = z.object({
  id: z.guid(),
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
  id: z.guid(),
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
  id: z.guid(),
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
