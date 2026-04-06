import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { DateAlbumQueryKeys } from "../../albums/hooks/useFetchDateAlbumQuery";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";
import { RecentlyAddedPhotosQueryKeys } from "./useFetchRecentlyAddedPhotosQuery";

const RotatePhotosResponse = z.discriminatedUnion("status", [
  z.object({
    status: z.literal(true),
    image_hash: z.string(),
    local_orientation: z.number(),
    last_modified: z.string(),
  }),
  z.object({
    status: z.literal(false),
    message: z.string().optional(),
  }),
]);

export type RotatePhotosRequest = {
  image_hash: string;
  angle: number;
};

// Rotate photos non-destructively
export const useRotatePhotosMutation = () =>
  useMutation({
    mutationFn: async (request: RotatePhotosRequest) => {
      const response = await fetchClient.post("/photosedit/rotate/", request);
      const data = parseWithNotification(
        RotatePhotosResponse,
        response,
        "Failed to parse rotate photos response"
      );

      notification.rotatePhotos(1, request.angle);

      return data;
    },
    onSuccess: (data, request) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });

      queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, request.image_hash] });
    },
  });
