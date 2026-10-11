/**
 * Photo Metadata API client
 *
 * Provides functions for:
 * - Fetching full structured metadata
 * - Updating metadata (the backend records each change as a MetadataEdit)
 * - Bulk metadata updates
 *
 * The backend's history, revert and revert-all endpoints have no client here
 * until a screen uses them (#2285, deferred to #2252).
 */

import { parseWithNotification } from "../../util/zodUtils";
import { fetchClient } from "../api";
import { PhotoMetadata } from "./types";

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
 * Bulk update metadata for multiple photos
 * @param photoIds Array of photo UUIDs or image_hashes
 * @param updates Fields to update on all photos
 */
export async function bulkUpdateMetadata(
  photoIds: string[],
  updates: MetadataUpdateFields
): Promise<{ updated_count: number; message: string }> {
  return fetchClient.patch<{ updated_count: number; message: string }>("/photos/metadata/bulk", {
    photo_ids: photoIds,
    updates,
  });
}
