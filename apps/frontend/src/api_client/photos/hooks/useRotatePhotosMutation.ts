import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { DateAlbumQueryKeys } from "../../albums/hooks/useFetchDateAlbumQuery";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { BulkPhotoQuery } from "../types";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";
import { RecentlyAddedPhotosQueryKeys } from "./useFetchRecentlyAddedPhotosQuery";

const RotatePhotosResponse = z.object({
  status: z.boolean(),
  count: z.number().optional(),
});

// Request type for individual photo hashes
type IndividualRequest = {
  select_all?: false;
  image_hashes: string[];
  rotation: number;
};

// Request type for select_all mode
type SelectAllRequest = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
  rotation: number;
};

export type RotatePhotosRequest = IndividualRequest | SelectAllRequest;

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

      // Show notification based on mode
      if (request.select_all) {
        notification.rotatePhotos(data.count ?? 0, request.rotation);
      } else {
        notification.rotatePhotos(request.image_hashes.length, request.rotation);
      }

      return data;
    },
    onSuccess: (data, request) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });

      // If we have a single photo in individual mode, invalidate its details
      if (!request.select_all && request.image_hashes.length === 1) {
        queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, request.image_hashes[0]] });
      }
    },
  });
