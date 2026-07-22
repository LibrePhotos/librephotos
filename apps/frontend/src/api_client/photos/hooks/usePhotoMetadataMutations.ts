/**
 * React Query mutation hooks for photo metadata operations
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  bulkUpdateMetadata,
  revertAllMetadataEdits,
  revertMetadataEdit,
  updatePhotoMetadata,
  type MetadataUpdateFields,
} from "../metadata";

/**
 * Update metadata for a photo (changes are tracked in history)
 *
 * These mutations delegate to the api_client functions so their responses are
 * validated against the PhotoMetadata schema instead of being blind-cast.
 */
export function useUpdatePhotoMetadataMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ photoId, updates }: { photoId: string; updates: MetadataUpdateFields }) =>
      updatePhotoMetadata(photoId, updates),
    onSuccess: (data, { photoId }) => {
      // Invalidate metadata queries
      queryClient.invalidateQueries({ queryKey: ["photoMetadata", photoId] });
      queryClient.invalidateQueries({ queryKey: ["metadataHistory", photoId] });
      // Also invalidate photo details since it includes metadata summary
      queryClient.invalidateQueries({ queryKey: ["photoDetails"] });
    },
  });
}

/**
 * Revert a specific metadata edit
 */
export function useRevertMetadataEditMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ photoId, editId }: { photoId: string; editId: string }) => revertMetadataEdit(photoId, editId),
    onSuccess: (data, { photoId }) => {
      queryClient.invalidateQueries({ queryKey: ["photoMetadata", photoId] });
      queryClient.invalidateQueries({ queryKey: ["metadataHistory", photoId] });
      queryClient.invalidateQueries({ queryKey: ["photoDetails"] });
    },
  });
}

/**
 * Revert all edits and restore original embedded metadata
 */
export function useRevertAllMetadataEditsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (photoId: string) => revertAllMetadataEdits(photoId),
    onSuccess: (data, photoId) => {
      queryClient.invalidateQueries({ queryKey: ["photoMetadata", photoId] });
      queryClient.invalidateQueries({ queryKey: ["metadataHistory", photoId] });
      queryClient.invalidateQueries({ queryKey: ["photoDetails"] });
    },
  });
}

/**
 * Bulk update metadata for multiple photos
 */
export function useBulkUpdateMetadataMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ photoIds, updates }: { photoIds: string[]; updates: MetadataUpdateFields }) =>
      bulkUpdateMetadata(photoIds, updates),
    onSuccess: (data, { photoIds }) => {
      // Invalidate all affected photo metadata queries
      photoIds.forEach(photoId => {
        queryClient.invalidateQueries({ queryKey: ["photoMetadata", photoId] });
        queryClient.invalidateQueries({ queryKey: ["metadataHistory", photoId] });
      });
      queryClient.invalidateQueries({ queryKey: ["photoDetails"] });
    },
  });
}
