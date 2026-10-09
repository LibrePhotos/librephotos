import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { BulkPhotoQuery } from "../types";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";

const UpdatedPhotosResponse = z.object({
  status: z.boolean(),
  // Hashes, not serialized photos: the backend no longer builds a payload per photo.
  updated_hashes: z.string().array().optional(),
  not_updated_hashes: z.string().array().optional(),
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
      // Every grid draws the star from the list data
      invalidatePhotoLists();

      // If we have a single photo in individual mode, invalidate its details
      if (!request.select_all && request.image_hashes.length === 1) {
        queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, request.image_hashes[0]] });
      }
    },
  });
