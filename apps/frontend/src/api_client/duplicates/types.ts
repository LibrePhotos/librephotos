import { z } from "zod";

// Types for duplicate detection feature

export const DuplicatePhoto = z.object({
  image_hash: z.string(),
  square_thumbnail_url: z.string().nullable(),
  big_thumbnail_url: z.string().nullable(),
  image_path: z.string().array(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  size: z.number(),
  rating: z.number(),
  exif_timestamp: z.string().nullable(),
  video: z.boolean(),
  camera: z.string().nullable(),
  lens: z.string().nullable(),
});
export type DuplicatePhoto = z.infer<typeof DuplicatePhoto>;

export const DuplicateGroupPreviewPhoto = z.object({
  image_hash: z.string(),
  square_thumbnail_url: z.string().nullable(),
});
export type DuplicateGroupPreviewPhoto = z.infer<typeof DuplicateGroupPreviewPhoto>;

export const DuplicateGroupListItem = z.object({
  id: z.number(),
  status: z.enum(["pending", "reviewed", "dismissed"]),
  created_at: z.string(),
  photo_count: z.number(),
  preview_photos: DuplicateGroupPreviewPhoto.array(),
});
export type DuplicateGroupListItem = z.infer<typeof DuplicateGroupListItem>;

export const DuplicateGroupListResponse = z.object({
  results: DuplicateGroupListItem.array(),
  count: z.number(),
  num_pages: z.number(),
  page: z.number(),
  page_size: z.number(),
  has_next: z.boolean(),
  has_previous: z.boolean(),
});
export type DuplicateGroupListResponse = z.infer<typeof DuplicateGroupListResponse>;

export const DuplicateGroup = z.object({
  id: z.number(),
  status: z.enum(["pending", "reviewed", "dismissed"]),
  created_at: z.string(),
  updated_at: z.string(),
  photo_count: z.number(),
  preferred_photo_hash: z.string().nullable(),
  photos: DuplicatePhoto.array(),
});
export type DuplicateGroup = z.infer<typeof DuplicateGroup>;

export const DuplicateStats = z.object({
  total_groups: z.number(),
  pending_groups: z.number(),
  reviewed_groups: z.number(),
  photos_in_groups: z.number(),
  photos_with_hash: z.number(),
  total_photos: z.number(),
  // Saved user preferences
  saved_sensitivity: z.enum(["strict", "normal", "loose"]).optional(),
  saved_clear_existing: z.boolean().optional(),
});
export type DuplicateStats = z.infer<typeof DuplicateStats>;

export const ResolveDuplicateRequest = z.object({
  keep_photo_hash: z.string(),
  trash_others: z.boolean().default(true),
});

export const DetectDuplicatesRequest = z.object({
  sensitivity: z.enum(["strict", "normal", "loose"]).or(z.string()).optional(),
  clear_existing: z.boolean().optional(),
});
export type DetectDuplicatesRequest = z.infer<typeof DetectDuplicatesRequest>;

export type DuplicateSensitivity = "strict" | "normal" | "loose";

export interface DetectDuplicatesParams {
  sensitivity?: DuplicateSensitivity;
  clearExisting?: boolean;
}
export type ResolveDuplicateRequest = z.infer<typeof ResolveDuplicateRequest>;
