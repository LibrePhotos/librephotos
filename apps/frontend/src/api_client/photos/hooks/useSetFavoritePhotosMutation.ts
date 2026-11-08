import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { selectionArgs, singlePhotoHash, type PhotoSelection } from "../photoSelection";
import { useBulkPhotoToggle } from "./useBulkPhotoToggle";

type FavoritePhotosRequest = PhotoSelection & { favorite: boolean };

async function setFavorite(request: FavoritePhotosRequest) {
  const [imageHashes, selectAll] = selectionArgs(request);
  return endpoints.setPhotosFavorite(apiClient, imageHashes, request.favorite, selectAll);
}

function refresh(queryClient: QueryClient, request: FavoritePhotosRequest) {
  // Every grid draws the star from the list data
  invalidatePhotoLists(queryClient);

  // If we have a single photo in individual mode, invalidate its details
  const imageHash = singlePhotoHash(request);
  if (imageHash !== undefined) {
    void queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
  }
}

/** Favorite or unfavorite photos; the toast's Undo sets them back. */
export const useSetFavoritePhotosMutation = () => {
  const queryClient = useQueryClient();
  return useBulkPhotoToggle({
    send: setFavorite,
    refresh: request => refresh(queryClient, request),
    invert: (request, image_hashes) => ({ image_hashes, favorite: !request.favorite }),
    notify: (count, request, undo) => notification.togglePhotosFavorite(count, request.favorite, undo),
  });
};
