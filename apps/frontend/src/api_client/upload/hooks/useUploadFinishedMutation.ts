import { useMutation } from "@tanstack/react-query";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { RecentlyAddedPhotosQueryKeys } from "../../photos/hooks/useFetchRecentlyAddedPhotosQuery";
import { StorageStatsQueryKeys } from "../../server/hooks/useFetchStorageStatsQuery";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { PhotoMonthCountQueryKeys } from "../../stats/hooks/useFetchPhotoMonthCountQuery";

const uploadFinished = (options: { formData: FormData; shouldInvalidate: boolean }) =>
  fetchClient.post("/upload/complete/", options.formData);

export const useUploadFinishedMutation = () =>
  useMutation({
    mutationFn: uploadFinished,
    onSuccess: (_data, variables) => {
      // Only invalidate queries if shouldInvalidate is true (i.e., this is the last file)
      if (variables.shouldInvalidate) {
        queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
        queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
        queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
        queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
        queryClient.invalidateQueries({ queryKey: [...StorageStatsQueryKeys] });
      }
    },
  });
