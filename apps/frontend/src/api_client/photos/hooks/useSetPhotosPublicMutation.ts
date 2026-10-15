import { endpoints, photoGridKeys, photoKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { selectionArgs, singlePhotoHash, type PhotoSelection } from "../photoSelection";

type SetPhotosPublicRequest = PhotoSelection & { val_public: boolean };

// Set photos public
export const useSetPhotosPublicMutation = () =>
  useMutation({
    mutationFn: async (request: SetPhotosPublicRequest) => {
      const [imageHashes, selectAll] = selectionArgs(request);
      const data = await endpoints.setPhotosPublic(apiClient, imageHashes, request.val_public, selectAll);

      // Show notification based on mode
      if (request.select_all) {
        notification.togglePhotosPublic(data.count ?? 0, request.val_public);
      } else {
        notification.togglePhotosPublic(request.image_hashes.length, request.val_public);
      }

      return data;
    },
    onSuccess: (data, request) => {
      // Invalidate relevant queries
      void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
      void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
      void queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });
      void queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("myPublicPhotos") });

      // If we have a single photo in individual mode, invalidate its details
      const imageHash = singlePhotoHash(request);
      if (imageHash !== undefined) {
        void queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
      }
    },
  });
