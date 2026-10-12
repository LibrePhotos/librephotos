import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys, photoKeys } from "../keys";

// A refused rotation is a 4xx/5xx (the backend's error envelope), so a 2xx
// is always a done rotation.
const RotatePhotosResponse = z.object({
  status: z.literal(true),
  image_hash: z.string(),
  local_orientation: z.number(),
  last_modified: z.string(),
});

export type RotatePhotosRequest = {
  image_hash: string;
  angle: number;
};

// Rotate photos non-destructively
export const useRotatePhotosMutation = () =>
  useMutation({
    mutationFn: async (request: RotatePhotosRequest) => {
      const response = await apiClient.post("/photosedit/rotate/", request);
      const data = parseWithNotification(RotatePhotosResponse, response, "Failed to parse rotate photos response");
      notification.rotatePhotos(1, request.angle);
      return data;
    },
    onSuccess: (_data, request) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });

      queryClient.invalidateQueries({ queryKey: photoKeys.detail(request.image_hash) });
    },
  });
