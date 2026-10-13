/**
 * React Query mutation hooks for photo metadata operations
 */

import { endpoints, photoKeys, tagKeys, type PhotoMetadataUpdate } from "@librephotos/api-client";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";

/**
 * Refresh everything a metadata edit can change.
 *
 * The backend writes each field to the store the app reads (#2252): a rating
 * is the photo's rating (favorites, the grid star), a caption is the lightbox
 * caption (search, hashtag albums), keywords are tags and search terms. So
 * besides the metadata itself, the photo details, every photo grid (search
 * included) and the tags are refetched.
 */
function invalidateAfterMetadataEdit(queryClient: QueryClient, photoIds: string[]) {
  photoIds.forEach(photoId => {
    queryClient.invalidateQueries({ queryKey: photoKeys.metadata(photoId) });
  });
  queryClient.invalidateQueries({ queryKey: photoKeys.details() });
  queryClient.invalidateQueries({ queryKey: tagKeys.all });
  invalidatePhotoLists(queryClient);
}

/**
 * Update metadata for a photo (changes are tracked in history)
 */
export function useUpdatePhotoMetadataMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ photoId, updates }: { photoId: string; updates: PhotoMetadataUpdate }) =>
      endpoints.updatePhotoMetadata(apiClient, photoId, updates),
    onSuccess: (data, { photoId }) => {
      invalidateAfterMetadataEdit(queryClient, [photoId]);
    },
  });
}

/**
 * Bulk update metadata for multiple photos
 */
export function useBulkUpdateMetadataMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ photoIds, updates }: { photoIds: string[]; updates: PhotoMetadataUpdate }) =>
      endpoints.bulkUpdatePhotoMetadata(apiClient, photoIds, updates),
    onSuccess: (data, { photoIds }) => {
      invalidateAfterMetadataEdit(queryClient, photoIds);
    },
  });
}
