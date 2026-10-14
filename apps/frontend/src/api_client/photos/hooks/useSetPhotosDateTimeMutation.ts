import { endpoints, photoKeys, statsKeys } from "@librephotos/api-client";
import type { DateTimeChange } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

/** The photos (by hash or select-all) and how their dates move. */
export type SetPhotosDateTimeRequest = { selection: PhotoSelection; change: DateTimeChange };

// Shift or set the date of the selected photos (#2278). The toast reports the photos changed and
// those a shift skipped because they have no date.
export const useSetPhotosDateTimeMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ selection, change }: SetPhotosDateTimeRequest) => {
      const [imageHashes, selectAll] = selectionArgs(selection);
      const data = await endpoints.setPhotosDateTime(apiClient, imageHashes, change, selectAll);
      notification.photosDateChanged(data.count, data.skipped_without_date);
      return data;
    },
    onSuccess: () => {
      // New dates move photos between days and months on every grid, out of "Photos without
      // Timestamps", and change the dates the info panel shows.
      invalidatePhotoLists(queryClient);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() }),
        queryClient.invalidateQueries({ queryKey: statsKeys.counts() }),
        queryClient.invalidateQueries({ queryKey: photoKeys.details() }),
      ]);
    },
  });
};
