import { z } from "zod";

// Types for organizational PhotoStack system
// For duplicates (exact copies, visual duplicates), see api_client/duplicates

export const StackType = z.enum(["raw_jpeg", "burst", "bracket", "live_photo", "manual"]);
export type StackType = z.infer<typeof StackType>;

// File variant within a stack photo
export const StackFileVariant = z.object({
  hash: z.string(),
  path: z.string(),
  type: z.string(),
  is_main: z.boolean(),
  filename: z.string().nullable(),
});
export type StackFileVariant = z.infer<typeof StackFileVariant>;

// Photo within a stack
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
  is_primary: z.boolean(),
  // File variants (RAW, JPEG, etc.) for this photo
  file_variants: StackFileVariant.array().nullable().optional(),
});
export type StackPhoto = z.infer<typeof StackPhoto>;

// Preview photo for list view
export const StackPreviewPhoto = z.object({
  image_hash: z.string(),
  thumbnail_url: z.string().nullable(),
});
export type StackPreviewPhoto = z.infer<typeof StackPreviewPhoto>;

// Primary photo info
export const StackPrimaryPhoto = z.object({
  image_hash: z.string(),
  thumbnail_url: z.string().nullable(),
});
export type StackPrimaryPhoto = z.infer<typeof StackPrimaryPhoto>;

// Stack list item (paginated list)
export const PhotoStackListItem = z.object({
  id: z.string(),
  stack_type: StackType,
  stack_type_display: z.string(),
  photo_count: z.number(),
  sequence_start: z.string().nullable(),
  sequence_end: z.string().nullable(),
  created_at: z.string(),
  primary_photo: StackPrimaryPhoto.nullable(),
  preview_photos: StackPreviewPhoto.array(),
});
export type PhotoStackListItem = z.infer<typeof PhotoStackListItem>;

// Paginated list response
export const PhotoStackListResponse = z.object({
  results: PhotoStackListItem.array(),
  count: z.number(),
  num_pages: z.number(),
  page: z.number(),
  page_size: z.number(),
  has_next: z.boolean(),
  has_previous: z.boolean(),
});
export type PhotoStackListResponse = z.infer<typeof PhotoStackListResponse>;

// Full stack detail
export const PhotoStack = z.object({
  id: z.string(),
  stack_type: StackType,
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

// Stack statistics
export const PhotoStackStats = z.object({
  total_stacks: z.number(),
  by_type: z.record(z.string(), z.number()),
  photos_in_stacks: z.number(),
  total_photos: z.number(),
});
export type PhotoStackStats = z.infer<typeof PhotoStackStats>;

// Request types
export const SetPrimaryRequest = z.object({
  photo_hash: z.string(),
});
export type SetPrimaryRequest = z.infer<typeof SetPrimaryRequest>;

export const CreateManualStackRequest = z.object({
  photo_hashes: z.string().array(),
});
export type CreateManualStackRequest = z.infer<typeof CreateManualStackRequest>;

export const AddToStackRequest = z.object({
  photo_hashes: z.string().array(),
});
export type AddToStackRequest = z.infer<typeof AddToStackRequest>;

export const RemoveFromStackRequest = z.object({
  photo_hashes: z.string().array(),
});
export type RemoveFromStackRequest = z.infer<typeof RemoveFromStackRequest>;

export const MergeStacksRequest = z.object({
  photo_hashes: z.string().array(),
});
export type MergeStacksRequest = z.infer<typeof MergeStacksRequest>;

export const DetectStacksRequest = z.object({
  detect_raw_jpeg: z.boolean().optional(),
  detect_bursts: z.boolean().optional(),
  detect_live_photos: z.boolean().optional(),
});
export type DetectStacksRequest = z.infer<typeof DetectStacksRequest>;

// Response types
export const DeleteStackResponse = z.object({
  status: z.literal("deleted"),
  unlinked_count: z.number(),
});
export type DeleteStackResponse = z.infer<typeof DeleteStackResponse>;

export const SetPrimaryResponse = z.object({
  status: z.literal("updated"),
  primary_photo_hash: z.string(),
});
export type SetPrimaryResponse = z.infer<typeof SetPrimaryResponse>;

export const CreateManualStackResponse = z.object({
  status: z.literal("created"),
  stack_id: z.string(),
  photo_count: z.number(),
});
export type CreateManualStackResponse = z.infer<typeof CreateManualStackResponse>;

export const AddToStackResponse = z.object({
  status: z.literal("updated"),
  added_count: z.number(),
  total_count: z.number(),
});
export type AddToStackResponse = z.infer<typeof AddToStackResponse>;

export const RemoveFromStackResponse = z.object({
  status: z.union([z.literal("updated"), z.literal("deleted")]),
  removed_count: z.number(),
  total_count: z.number().optional(),
  message: z.string().optional(),
});
export type RemoveFromStackResponse = z.infer<typeof RemoveFromStackResponse>;

export const MergeStacksResponse = z.object({
  status: z.union([z.literal("merged"), z.literal("no_merge_needed")]),
  stack_id: z.string(),
  photo_count: z.number(),
  merged_count: z.number().optional(),
  message: z.string().optional(),
});
export type MergeStacksResponse = z.infer<typeof MergeStacksResponse>;

export const DetectStacksResponse = z.object({
  status: z.literal("queued"),
  message: z.string(),
  options: z.record(z.string(), z.unknown()),
});
export type DetectStacksResponse = z.infer<typeof DetectStacksResponse>;

// Display labels
export const stackTypeLabels: Record<StackType, string> = {
  raw_jpeg: "RAW + JPEG",
  burst: "Burst Sequence",
  bracket: "Exposure Bracket",
  live_photo: "Live Photo",
  manual: "Manual Stack",
};

export const stackTypeIcons: Record<StackType, string> = {
  raw_jpeg: "camera",
  burst: "bolt",
  bracket: "sun",
  live_photo: "video",
  manual: "stack",
};

// Schema exports with "Schema" suffix for compatibility with hooks.ts
export const StackListResponseSchema = PhotoStackListResponse;
export type StackListResponse = PhotoStackListResponse;

export const StackDetailResponseSchema = PhotoStack;
export type StackDetailResponse = PhotoStack;

export const StackStatsResponseSchema = PhotoStackStats;
export type StackStatsResponse = PhotoStackStats;

export const AddToStackRequestSchema = AddToStackRequest;
export const AddToStackResponseSchema = AddToStackResponse;

export const RemoveFromStackRequestSchema = RemoveFromStackRequest;
export const RemoveFromStackResponseSchema = RemoveFromStackResponse;

export const MergeStacksRequestSchema = MergeStacksRequest;
export const MergeStacksResponseSchema = MergeStacksResponse;

export const CreateManualStackRequestSchema = CreateManualStackRequest;
export const CreateManualStackResponseSchema = CreateManualStackResponse;

export const DetectStacksResponseSchema = DetectStacksResponse;
