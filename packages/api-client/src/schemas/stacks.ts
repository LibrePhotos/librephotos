import { z } from "zod";
import { MaybeFlag, PageFields, StackTypeEnum } from "./common";

/*
 * Organizational photo stacks: bursts, exposure brackets and manual groups (backend
 * api/views/stacks.py, which builds its answers by hand; the response serializers in
 * api/serializers/stack.py describe them for openapi.json).
 * Duplicates (exact copies, visual duplicates) are in ./duplicates. RAW + JPEG pairs and
 * Live Photos are file variants now, not stacks.
 */

/** The types the stack list returns, and so the ones its filter offers and counts. */
export const StackType = z.enum(["burst", "bracket", "manual"]);
export type StackType = z.infer<typeof StackType>;

/** One file of a stack photo (RAW, JPEG, ...). */
export const StackFileVariant = z.object({
  hash: z.string(),
  path: z.string(),
  type: z.string(),
  is_main: MaybeFlag,
  filename: z.string().nullable(),
});
export type StackFileVariant = z.infer<typeof StackFileVariant>;

/** A photo in a stack's detail. */
export const StackPhoto = z.object({
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
  is_primary: MaybeFlag,
  /** The photo's file variants (RAW, JPEG, ...); null when it has none. */
  file_variants: StackFileVariant.array().nullable().optional(),
});
export type StackPhoto = z.infer<typeof StackPhoto>;

/** A small photo of a stack in the list: its cover or one of the first four. */
export const StackThumbnail = z.object({
  image_hash: z.string(),
  thumbnail_url: z.string().nullable(),
});
export type StackThumbnail = z.infer<typeof StackThumbnail>;

/** A row of the stack list. */
export const PhotoStackListItem = z.object({
  id: z.string(),
  stack_type: StackType,
  stack_type_display: z.string(),
  photo_count: z.number(),
  sequence_start: z.string().nullable(),
  sequence_end: z.string().nullable(),
  created_at: z.string(),
  primary_photo: StackThumbnail.nullable(),
  preview_photos: StackThumbnail.array(),
});
export type PhotoStackListItem = z.infer<typeof PhotoStackListItem>;

/**
 * One page of stacks: the shared page envelope (backend api/drf/pagination.py).
 */
export const PhotoStackListResponse = z.object({
  ...PageFields,
  results: PhotoStackListItem.array(),
});
export type PhotoStackListResponse = z.infer<typeof PhotoStackListResponse>;

/**
 * A stack with all its photos. A photo's lightbox can still open a legacy RAW + JPEG or Live
 * Photo stack (left by migration 0112), so this takes every stored type.
 */
export const PhotoStack = z.object({
  id: z.string(),
  stack_type: StackTypeEnum,
  stack_type_display: z.string(),
  photo_count: z.number(),
  sequence_start: z.string().nullable(),
  sequence_end: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  primary_photo_hash: z.string().nullable(),
  photos: StackPhoto.array(),
});
export type PhotoStack = z.infer<typeof PhotoStack>;

/**
 * Stack counts. `by_type` also counts the legacy RAW + JPEG and Live Photo stacks, which the
 * list never returns (see countListedStacks).
 */
export const PhotoStackStats = z.object({
  total_stacks: z.number(),
  by_type: z.record(z.string(), z.number()),
  photos_in_stacks: z.number(),
  total_photos: z.number(),
});
export type PhotoStackStats = z.infer<typeof PhotoStackStats>;

/**
 * How many stacks the list can show: the listed types summed from `by_type`. `by_type` still
 * counts legacy RAW + JPEG / Live Photo stacks, and so does `total_stacks` on servers before
 * 1.3 (whose `by_type` also counted single-photo stacks, which the list hides). Once those
 * need no support, `total_stacks` can be used directly.
 */
export const countListedStacks = (stats: PhotoStackStats): number =>
  StackType.options.reduce((sum, type) => sum + (stats.by_type[type] ?? 0), 0);

/** `POST /stacks/{id}/primary/`: the new cover photo. */
export const SetStackPrimaryResponse = z.object({
  status: z.literal("updated"),
  primary_photo_hash: z.string(),
});
export type SetStackPrimaryResponse = z.infer<typeof SetStackPrimaryResponse>;

/** `POST /stacks/manual/`: the manual stack the photos are in now (an existing one, or new). */
export const CreateManualStackResponse = z.object({
  status: z.literal("created"),
  stack_id: z.string(),
  photo_count: z.number(),
});
export type CreateManualStackResponse = z.infer<typeof CreateManualStackResponse>;

/** `POST /stacks/{id}/remove/`: `deleted` when fewer than two photos were left. */
export const RemoveFromStackResponse = z.object({
  status: z.union([z.literal("updated"), z.literal("deleted")]),
  removed_count: z.number(),
  total_count: z.number().optional(),
  message: z.string().optional(),
});
export type RemoveFromStackResponse = z.infer<typeof RemoveFromStackResponse>;

/** `POST /stacks/merge/`: the manual stack the others were merged into. */
export const MergeStacksResponse = z.object({
  status: z.union([z.literal("merged"), z.literal("no_merge_needed")]),
  stack_id: z.string(),
  photo_count: z.number(),
  merged_count: z.number().optional(),
  message: z.string().optional(),
});
export type MergeStacksResponse = z.infer<typeof MergeStacksResponse>;

/** `DELETE /stacks/{id}/` and `/duplicates/{id}/delete`: the group is gone, its photos stay. */
export const UnlinkGroupResponse = z.looseObject({
  status: z.string(),
  unlinked_count: z.number(),
});
export type UnlinkGroupResponse = z.infer<typeof UnlinkGroupResponse>;

/** `POST /stacks/detect/` and `/duplicates/detect`: the detection job was queued. */
export const DetectionQueuedResponse = z.object({
  status: z.literal("queued"),
  message: z.string(),
  options: z.record(z.string(), z.unknown()),
  job_id: z.string().optional(),
});
export type DetectionQueuedResponse = z.infer<typeof DetectionQueuedResponse>;

/** What stack detection looks for. RAW + JPEG pairs and Live Photos are file variants now. */
export type DetectStacksRequest = {
  detect_bursts?: boolean;
};
