import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { statsKeys } from "../../stats/keys";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { photoKeys } from "../keys";
import type { Photo } from "../types";

export const useUpdatePhotoMutation = () =>
  useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Photo> }) => {
      const result = await endpoints.updatePhoto(apiClient, id, data);
      notification.updatePhoto();
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
