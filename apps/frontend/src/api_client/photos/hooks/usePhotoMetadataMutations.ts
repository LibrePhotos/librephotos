/**
 * React Query mutation hooks for photo metadata operations
 */

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { TagsQueryKeys } from "../../tags/hooks/useFetchTagsQuery";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { bulkUpdateMetadata, updatePhotoMetadata, type MetadataUpdateFields } from "../metadata";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";

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
    queryClient.invalidateQueries({ queryKey: ["photoMetadata", photoId] });
  });
  queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys] });
  queryClient.invalidateQueries({ queryKey: [...TagsQueryKeys] });
  invalidatePhotoLists(queryClient);
}

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
    mutationFn: ({ photoIds, updates }: { photoIds: string[]; updates: MetadataUpdateFields }) =>
      bulkUpdateMetadata(photoIds, updates),
    onSuccess: (data, { photoIds }) => {
      invalidateAfterMetadataEdit(queryClient, photoIds);
    },
  });
}
