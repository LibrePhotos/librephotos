import { endpoints, photoKeys, statsKeys } from "@librephotos/api-client";
import type { Photo, PhotoEditResponse } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";

/**
 * The coordinates are saved either way. A lookup that failed gets a warning; a spot with no place
 * name (open sea) is not a failure (#2589). Older servers only send `geocoded`.
 */
function notifyLocationSaved({ geocode_status: status, geocoded }: PhotoEditResponse) {
  if (status === "no_place") notification.locationSavedNoPlace();
  else if (status === "failed" || (status === undefined && geocoded === false))
    notification.locationSavedWithoutPlace();
  else notification.updatePhoto();
}

export const useUpdatePhotoMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Photo> }) => {
      const result = await endpoints.updatePhoto(apiClient, id, data);
      // A removed location has no place to look up (#2209).
      if ("exif_gps_lat" in data && data.exif_gps_lat === null) notification.locationRemoved();
      else if ("exif_gps_lat" in data) notifyLocationSaved(result);
      else notification.updatePhoto();
      return result;
    },
    onSuccess: (data, { data: patch }) => {
      // A new date moves the photo to another day on the timeline, and out of
      // the no-timestamp list.
      if ("exif_timestamp" in patch) {
        invalidatePhotoLists(queryClient);
        void queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });
      }
      // Returned, so a caller's onSuccess sees the photo as saved: the date editor
      // closes on the new date, not on the old one until the refetch lands (#2280).
      return queryClient.invalidateQueries({ queryKey: photoKeys.detail(data.image_hash) });
    },
  });
};
