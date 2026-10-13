import { endpoints, photoGridKeys, serverKeys, statsKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";

type UploadFinishedOptions = {
  formData: FormData;
  // shouldInvalidate is used by the onSuccess callback to determine
  // whether to invalidate queries after upload completion
  shouldInvalidate: boolean;
};

export const invalidateUploadQueries = () => {
  queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });
  // Both the day list and the per-day photo pages: refetching only the list
  // replaced every day with temp placeholders that nothing re-requested (the
  // grid had already asked for those pages), so the timeline turned into
  // empty date headers after an upload.
  queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
  queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
  queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
  queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });
  queryClient.invalidateQueries({ queryKey: serverKeys.storageStats() });
};

const uploadFinished = (options: UploadFinishedOptions) => endpoints.completeUpload(apiClient, options.formData);

export const useUploadFinishedMutation = () =>
  useMutation({
    mutationFn: uploadFinished,
    onSuccess: (_data, variables) => {
      // Only invalidate queries if shouldInvalidate is true (i.e., this is the last file)
      if (variables.shouldInvalidate) {
        invalidateUploadQueries();
      }
    },
  });
