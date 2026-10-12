import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { statsKeys } from "../../stats/keys";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { photoKeys } from "../keys";
import type { Photo } from "../types";

const PhotoUpdateResponse = z.object({
  image_hash: z.string(),
  hidden: z.boolean(),
  rating: z.number(),
  in_trashcan: z.boolean(),
  removed: z.boolean(),
  video: z.boolean(),
  exif_timestamp: z.string().nullable(),
  timestamp: z.string().nullable(),
});
type PhotoUpdateResponse = z.infer<typeof PhotoUpdateResponse>;

export const useUpdatePhotoMutation = () =>
  useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Photo> }) => {
      const response = await apiClient.patch(`/photos/edit/${id}/`, data);
      const result = parseWithNotification(PhotoUpdateResponse, response, "Failed to parse photo update response");
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
