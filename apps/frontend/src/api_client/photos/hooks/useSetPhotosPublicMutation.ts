import { endpoints, photoGridKeys, photoKeys } from "@librephotos/api-client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { selectionArgs, singlePhotoHash, type PhotoSelection } from "../photoSelection";
import { useBulkPhotoToggle } from "./useBulkPhotoToggle";

type SetPhotosPublicRequest = PhotoSelection & { val_public: boolean };

async function setPublic(request: SetPhotosPublicRequest) {
  const [imageHashes, selectAll] = selectionArgs(request);
  return endpoints.setPhotosPublic(apiClient, imageHashes, request.val_public, selectAll);
}

function refresh(queryClient: QueryClient, request: SetPhotosPublicRequest) {
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });
  void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("myPublicPhotos") });

  // If we have a single photo in individual mode, invalidate its details
  const imageHash = singlePhotoHash(request);
  if (imageHash !== undefined) {
    void queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
  }
}

/** Make photos public or private; the toast's Undo sets them back. */
export const useSetPhotosPublicMutation = () => {
  const queryClient = useQueryClient();
  return useBulkPhotoToggle({
    send: setPublic,
    refresh: request => refresh(queryClient, request),
    invert: (request, image_hashes) => ({ image_hashes, val_public: !request.val_public }),
    notify: (count, request, undo) => notification.togglePhotosPublic(count, request.val_public, undo),
  });
};
