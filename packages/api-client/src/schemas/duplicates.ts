import { z } from "zod";
import { MaybeFlag, PageFields } from "./common";

/*
 * Duplicate groups: exact copies and visually similar photos, for storage cleanup (backend
 * api/views/duplicates.py, which builds its answers by hand; the response serializers in
 * api/serializers/duplicate.py describe them for openapi.json).
 * Organizational grouping (bursts, brackets, manual) is in ./stacks.
 */

export const DuplicateType = z.enum(["exact_copy", "visual_duplicate"]);
export type DuplicateType = z.infer<typeof DuplicateType>;

export const ReviewStatus = z.enum(["pending", "resolved", "dismissed"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** A photo in a duplicate group's detail. */
export const DuplicatePhoto = z.object({
  id: z.string(),
  image_hash: z.string(),
  thumbnail_url: z.string().nullable(),
  thumbnail_big_url: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  size: z.number(),
  exif_timestamp: z.string().nullable(),
  camera: z.string().nullable(),
  file_path: z.string().nullable(),
  file_type: z.string().nullable(),
  /** Null from the server while the group has no kept photo (a pending group). */
  is_kept: MaybeFlag,
});
export type DuplicatePhoto = z.infer<typeof DuplicatePhoto>;

/** A small photo of a group in the list: the kept one or one of the first four. */
export const DuplicateThumbnail = z.object({
  image_hash: z.string(),
  thumbnail_url: z.string().nullable(),
});
export type DuplicateThumbnail = z.infer<typeof DuplicateThumbnail>;

/** A row of the duplicate list. */
export const DuplicateListItem = z.object({
  id: z.string(),
  duplicate_type: DuplicateType,
  duplicate_type_display: z.string(),
  review_status: ReviewStatus,
  review_status_display: z.string(),
  photo_count: z.number(),
  potential_savings: z.number(),
  similarity_score: z.number().nullable(),
  created_at: z.string(),
  kept_photo: DuplicateThumbnail.nullable(),
  preview_photos: DuplicateThumbnail.array(),
});
export type DuplicateListItem = z.infer<typeof DuplicateListItem>;

/**
 * One page of duplicate groups: the shared page envelope (backend api/drf/pagination.py). The
 * server still adds `has_next`/`has_previous` for bundles up to 1.3; `next`/`previous` say the same.
 */
export const DuplicateListResponse = z.object({
  ...PageFields,
  results: DuplicateListItem.array(),
});
export type DuplicateListResponse = z.infer<typeof DuplicateListResponse>;

/** A duplicate group with all its photos. */
export const DuplicateDetail = z.object({
  id: z.string(),
  duplicate_type: DuplicateType,
  duplicate_type_display: z.string(),
  review_status: ReviewStatus,
  review_status_display: z.string(),
  photo_count: z.number(),
  potential_savings: z.number(),
  similarity_score: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  kept_photo_hash: z.string().nullable(),
  suggested_photo_hash: z.string().nullable(),
  photos: DuplicatePhoto.array(),
});
export type DuplicateDetail = z.infer<typeof DuplicateDetail>;

/** Duplicate counts; the savings are those of the pending groups. */
export const DuplicateStats = z.object({
  total_duplicates: z.number(),
  pending_duplicates: z.number(),
  resolved_duplicates: z.number(),
  dismissed_duplicates: z.number(),
  by_type: z.record(z.string(), z.number()),
  photos_in_duplicates: z.number(),
  total_photos: z.number(),
  potential_savings_bytes: z.number(),
  potential_savings_mb: z.number(),
});
export type DuplicateStats = z.infer<typeof DuplicateStats>;

/** `POST /duplicates/{id}/resolve`: the photo kept and how many others went to the trash. */
export const ResolveDuplicateResponse = z.object({
  status: z.literal("resolved"),
  kept_photo: z.string(),
  trashed_count: z.number(),
});
export type ResolveDuplicateResponse = z.infer<typeof ResolveDuplicateResponse>;

/** `POST /duplicates/{id}/dismiss` (`status: "dismissed"`). */
export const DismissDuplicateResponse = z.looseObject({
  status: z.string(),
});
export type DismissDuplicateResponse = z.infer<typeof DismissDuplicateResponse>;

/** `POST /duplicates/{id}/revert`: the trashed photos restored. */
export const RevertDuplicateResponse = z.looseObject({
  status: z.string(),
  restored_count: z.number(),
});
export type RevertDuplicateResponse = z.infer<typeof RevertDuplicateResponse>;

/** What duplicate detection looks for (backend DetectDuplicatesRequest; unset keys take its defaults). */
export type DetectDuplicatesRequest = {
  detect_exact_copies?: boolean;
  detect_visual_duplicates?: boolean;
  visual_threshold?: number;
  clear_pending?: boolean;
};
