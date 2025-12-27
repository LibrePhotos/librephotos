import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { DateAlbumQueryKeys } from "../../albums/hooks/useFetchDateAlbumQuery";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { BulkPhotoQuery, Photo } from "../types";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";
import { RecentlyAddedPhotosQueryKeys } from "./useFetchRecentlyAddedPhotosQuery";

const UpdatedPhotosResponse = z.object({
  status: z.boolean(),
  results: Photo.array().optional(),
  updated: Photo.array().optional(),
  not_updated: Photo.array().optional(),
  count: z.number().optional(),
});
type UpdatedPhotosResponse = z.infer<typeof UpdatedPhotosResponse>;

// Request type for individual photo hashes
type IndividualRequest = {
  select_all?: false;
  image_hashes: string[];
  favorite: boolean;
};

// Request type for select_all mode
type SelectAllRequest = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
  favorite: boolean;
};

type FavoritePhotosRequest = IndividualRequest | SelectAllRequest;

// Set favorite photos
export const useSetFavoritePhotosMutation = () =>
  useMutation({
    mutationFn: async (request: FavoritePhotosRequest) => {
      const response = await fetchClient.post("/photosedit/favorite/", request);
      const data = parseWithNotification(
        UpdatedPhotosResponse,
        response,
        "Failed to parse set favorite photos response"
      );

      // Show notification based on mode
      if (request.select_all) {
        notification.togglePhotosFavorite(data.count ?? 0, request.favorite);
      } else {
        notification.togglePhotosFavorite(request.image_hashes.length, request.favorite);
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
