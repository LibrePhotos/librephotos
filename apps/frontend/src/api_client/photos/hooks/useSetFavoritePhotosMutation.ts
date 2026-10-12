import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { photoKeys } from "../keys";
import { selectionArgs, singlePhotoHash, type PhotoSelection } from "../photoSelection";

type FavoritePhotosRequest = PhotoSelection & { favorite: boolean };

// Set favorite photos
export const useSetFavoritePhotosMutation = () =>
  useMutation({
    mutationFn: async (request: FavoritePhotosRequest) => {
      const [imageHashes, selectAll] = selectionArgs(request);
      const data = await endpoints.setPhotosFavorite(apiClient, imageHashes, request.favorite, selectAll);

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
      invalidatePhotoLists(queryClient);

      // If we have a single photo in individual mode, invalidate its details
      const imageHash = singlePhotoHash(request);
      if (imageHash !== undefined) {
        queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
      }
    },
  });
