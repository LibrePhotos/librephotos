import { z } from "zod";
import { MetadataSourceEnum } from "./photos";

/**
 * One change in a photo's metadata history: MetadataEditSerializer. `id` is a UUID string
 * (MetadataEdit has a UUIDField primary key).
 */
export const MetadataEdit = z.object({
  id: z.guid(),
  field_name: z.string(),
  // JSONFields: whatever the edited field held (a string, number, list...).
  old_value: z.unknown(),
  new_value: z.unknown(),
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

/** A sidecar file of a photo: MetadataFileSerializer. `id` is a UUID string. */
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

/**
 * GET and PATCH /photos/{id}/metadata: PhotoMetadataSerializer, field for field. It sends no
 * `photo_id` (the URL names the photo) and no `has_edits` (only PhotoMetadataSummarySerializer
 * has it); `edit_history` tells whether a photo was edited.
 */
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

/** The fields PATCH /photos/{id}/metadata and the bulk update change (PhotoMetadataUpdateSerializer). */
export type PhotoMetadataUpdate = {
  title?: string;
  caption?: string;
  keywords?: string[];
  rating?: number;
  copyright?: string;
  creator?: string;
};

/** PATCH /photos/metadata/bulk: how many photos changed. */
export const BulkMetadataUpdateResponse = z.looseObject({
  updated_count: z.number(),
  message: z.string(),
});
export type BulkMetadataUpdateResponse = z.infer<typeof BulkMetadataUpdateResponse>;
