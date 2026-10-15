import {
  endpoints,
  invalidateAfter,
  photoGridKeys,
  POLL_IDLE_MS,
  serverKeys,
  statsKeys,
} from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateUserAlbumPhotos } from "../../albums/invalidateUserAlbumPhotos";
import { apiClient, queryClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

type UploadFinishedOptions = {
  formData: FormData;
  // shouldInvalidate is used by the onSuccess callback to determine
  // whether to invalidate queries after upload completion
  shouldInvalidate: boolean;
};

export const invalidateUploadQueries = () => {
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });
  // Both the day list and the per-day photo pages: refetching only the list
  // replaced every day with temp placeholders that nothing re-requested (the
  // grid had already asked for those pages), so the timeline turned into
  // empty date headers after an upload.
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
  // A new photo is in no album until it is filed into one (#2584)
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("notInAlbum") });
  void queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
  void queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });
  void queryClient.invalidateQueries({ queryKey: serverKeys.storageStats() });
};

/**
 * Refreshes the albums an upload filed into (#612): their card, grid and the "Not in an album"
 * list. The server adds an uploaded photo to its album in the import chain, after the upload has
 * answered, so the grids are read again once the last imports have had time to land.
 */
export function useRefreshUploadAlbums(): (albumIds: number[]) => void {
  const client = useQueryClient();
  return albumIds => {
    if (albumIds.length === 0) return;
    albumIds.forEach(id => invalidateUserAlbumPhotos(client, String(id)));
    invalidateAfter(
      client,
      [photoGridKeys.kind("notInAlbum"), ...albumIds.map(id => photoGridKeys.userAlbum(String(id)))],
      POLL_IDLE_MS
    );
  };
}

const uploadFinished = (options: UploadFinishedOptions) => endpoints.completeUpload(apiClient, options.formData);

export const useUploadFinishedMutation = (options: MutationErrorOptions = {}) =>
  useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: uploadFinished,
    onSuccess: (_data, variables) => {
      // Only invalidate queries if shouldInvalidate is true (i.e., this is the last file)
      if (variables.shouldInvalidate) {
        invalidateUploadQueries();
      }
    },
  });
