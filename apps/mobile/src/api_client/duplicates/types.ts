import { z } from 'zod'

// Types for duplicate detection and cleanup feature

export const DuplicateType = z.enum(['exact_copy', 'visual_duplicate'])
export type DuplicateType = z.infer<typeof DuplicateType>

export const ReviewStatus = z.enum(['pending', 'resolved', 'dismissed'])
export type ReviewStatus = z.infer<typeof ReviewStatus>

// Photo within a duplicate group
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
  is_kept: z.boolean(),
})
export type DuplicatePhoto = z.infer<typeof DuplicatePhoto>

// Preview photo for list view
export const DuplicatePreviewPhoto = z.object({
  image_hash: z.string(),
  thumbnail_url: z.string().nullable(),
})
export type DuplicatePreviewPhoto = z.infer<typeof DuplicatePreviewPhoto>

// Kept photo info
export const DuplicateKeptPhoto = z.object({
  image_hash: z.string(),
  thumbnail_url: z.string().nullable(),
})
export type DuplicateKeptPhoto = z.infer<typeof DuplicateKeptPhoto>

// Duplicate list item (paginated list)
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
  kept_photo: DuplicateKeptPhoto.nullable(),
  preview_photos: DuplicatePreviewPhoto.array(),
})
export type DuplicateListItem = z.infer<typeof DuplicateListItem>
// Alias for compatibility
export type Duplicate = DuplicateListItem

// Duplicate list response
export const DuplicateListResponse = z.object({
  results: DuplicateListItem.array(),
  count: z.number(),
  num_pages: z.number(),
  page: z.number(),
  page_size: z.number(),
  has_next: z.boolean(),
  has_previous: z.boolean(),
})
export type DuplicateListResponse = z.infer<typeof DuplicateListResponse>

// Duplicate detail (full info with all photos)
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
})
export type DuplicateDetail = z.infer<typeof DuplicateDetail>

// Duplicate statistics
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
})
export type DuplicateStats = z.infer<typeof DuplicateStats>

// API request/response types
export const ResolveDuplicateRequest = z.object({
  keep_photo_hash: z.string(),
  trash_others: z.boolean().default(true),
})
export type ResolveDuplicateRequest = z.infer<typeof ResolveDuplicateRequest>

export const ResolveDuplicateResponse = z.object({
  status: z.literal('resolved'),
  kept_photo: z.string(),
  trashed_count: z.number(),
})
export type ResolveDuplicateResponse = z.infer<typeof ResolveDuplicateResponse>

export const DetectDuplicatesRequest = z.object({
  detect_exact_copies: z.boolean().optional(),
  detect_visual_duplicates: z.boolean().optional(),
  visual_threshold: z.number().optional(),
  clear_pending: z.boolean().optional(),
})
export type DetectDuplicatesRequest = z.infer<typeof DetectDuplicatesRequest>

export const DetectDuplicatesResponse = z.object({
  status: z.literal('queued'),
  message: z.string(),
  options: z.record(z.string(), z.unknown()),
})
export type DetectDuplicatesResponse = z.infer<typeof DetectDuplicatesResponse>

// Display labels for duplicate types
export const duplicateTypeLabels: Record<DuplicateType, string> = {
  exact_copy: 'Exact Copies',
  visual_duplicate: 'Visual Duplicates',
}

// Display labels for review status
export const reviewStatusLabels: Record<ReviewStatus, string> = {
  pending: 'Pending Review',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
}
