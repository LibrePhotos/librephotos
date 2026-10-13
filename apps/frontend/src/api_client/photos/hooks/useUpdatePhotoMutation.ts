import { endpoints, photoKeys, statsKeys } from "@librephotos/api-client";
import type { Photo } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";

export const useUpdatePhotoMutation = () =>
  useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Photo> }) => {
      const result = await endpoints.updatePhoto(apiClient, id, data);
      // The coordinates are saved either way; say so when no place name came with them.
      if ("exif_gps_lat" in data && result.geocoded === false) {
        notification.locationSavedWithoutPlace();
      } else {
        notification.updatePhoto();
      }
      return result;
    },
    onSuccess: (data, { data: patch }) => {
      queryClient.invalidateQueries({ queryKey: photoKeys.detail(data.image_hash) });
      // A new date moves the photo to another day on the timeline, and out of
      // the no-timestamp list.
      if ("exif_timestamp" in patch) {
        invalidatePhotoLists(queryClient);
        queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });
      }
    },
  });
