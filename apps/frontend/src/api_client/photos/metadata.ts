/**
 * Photo Metadata API client
 *
 * Provides functions for:
 * - Fetching full structured metadata
 * - Updating metadata with edit history tracking
 * - Viewing edit history
 * - Reverting changes
 * - Bulk metadata operations
 */

import { z } from "zod";
import { parseWithNotification } from "../../util/zodUtils";
import { fetchClient } from "../api";
import { MetadataHistoryResponse, PhotoMetadata } from "./types";

// Response types
const BulkMetadataResponse = z.record(
  z.string(),
  z.object({
    camera: z.string().nullable(),
    lens: z.string().nullable(),
    date_taken: z.string().nullable(),
    has_location: z.boolean(),
    rating: z.number().nullable(),
  })
);
type BulkMetadataResponse = z.infer<typeof BulkMetadataResponse>;

// Editable metadata fields
export type MetadataUpdateFields = {
  title?: string;
  caption?: string;
  keywords?: string[];
  rating?: number;
  copyright?: string;
  creator?: string;
};

/**
 * Fetch full structured metadata for a photo
 * @param photoId Photo UUID or image_hash
 */
export async function fetchPhotoMetadata(photoId: string): Promise<PhotoMetadata> {
  const response = await fetchClient.get(`/photos/${photoId}/metadata`);
  return parseWithNotification(PhotoMetadata, response, "Failed to parse photo metadata");
}

/**
 * Update metadata for a photo (changes are tracked in history)
 * @param photoId Photo UUID or image_hash
 * @param updates Fields to update
 */
export async function updatePhotoMetadata(photoId: string, updates: MetadataUpdateFields): Promise<PhotoMetadata> {
  const response = await fetchClient.patch(`/photos/${photoId}/metadata`, updates);
  return parseWithNotification(PhotoMetadata, response, "Failed to parse updated photo metadata");
}

/**
 * Fetch metadata edit history for a photo
 * @param photoId Photo UUID or image_hash
 * @param page Page number (1-indexed)
 * @param pageSize Number of items per page
 */
export async function fetchMetadataHistory(photoId: string, page = 1, pageSize = 20): Promise<MetadataHistoryResponse> {
  const response = await fetchClient.get(`/photos/${photoId}/metadata/history?page=${page}&page_size=${pageSize}`);
  return parseWithNotification(MetadataHistoryResponse, response, "Failed to parse metadata history");
}

/**
 * Revert a specific metadata edit
 * @param photoId Photo UUID or image_hash
 * @param editId The ID of the edit to revert
 */
export async function revertMetadataEdit(photoId: string, editId: number): Promise<PhotoMetadata> {
  const response = await fetchClient.post(`/photos/${photoId}/metadata/revert/${editId}`);
  return parseWithNotification(PhotoMetadata, response, "Failed to parse reverted photo metadata");
}

/**
 * Revert all edits and restore original embedded metadata
 * @param photoId Photo UUID or image_hash
 */
export async function revertAllMetadataEdits(photoId: string): Promise<PhotoMetadata> {
  const response = await fetchClient.post(`/photos/${photoId}/metadata/revert-all`);
  return parseWithNotification(PhotoMetadata, response, "Failed to parse reverted photo metadata");
}

/**
 * Fetch metadata summary for multiple photos
 * @param photoIds Array of photo UUIDs or image_hashes
 */
export async function fetchBulkMetadata(photoIds: string[]): Promise<BulkMetadataResponse> {
  const response = await fetchClient.get(`/photos/metadata/bulk?photo_ids=${photoIds.join(",")}`);
  return parseWithNotification(BulkMetadataResponse, response, "Failed to parse bulk metadata");
}

/**
 * Bulk update metadata for multiple photos
 * @param photoIds Array of photo UUIDs or image_hashes
 * @param updates Fields to update on all photos
 */
export async function bulkUpdateMetadata(
  photoIds: string[],
  updates: MetadataUpdateFields
): Promise<{ updated_count: number; message: string }> {
  const response = await fetchClient.patch("/photos/metadata/bulk", {
    photo_ids: photoIds,
    updates,
  });
  return response as { updated_count: number; message: string };
}
