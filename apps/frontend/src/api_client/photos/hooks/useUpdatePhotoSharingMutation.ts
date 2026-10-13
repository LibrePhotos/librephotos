import { endpoints, photoGridKeys, photoKeys } from "@librephotos/api-client";
import type { SimpleUser } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { selectionArgs, singlePhotoHash, type PhotoSelection } from "../photoSelection";

type SharePhotosRequest = PhotoSelection & { val_shared: boolean; target_user: SimpleUser };

export const useUpdatePhotoSharingMutation = () =>
  useMutation({
    mutationFn: async (request: SharePhotosRequest) => {
      const [imageHashes, selectAll] = selectionArgs(request);
      const data = await endpoints.setPhotosShared(
        apiClient,
        imageHashes,
        request.target_user.id,
        request.val_shared,
        selectAll
      );

      // Show notification based on mode
      if (request.select_all) {
        notification.togglePhotoSharing(request.target_user.username, data.count ?? 0, request.val_shared);
      } else {
        notification.togglePhotoSharing(request.target_user.username, request.image_hashes.length, request.val_shared);
      }

      return data;
    },
    onSuccess: (_, request) => {
      queryClient.invalidateQueries({ queryKey: photoGridKeys.sharedByMe() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.sharedWithMe() });

      // If we have a single photo in individual mode, invalidate its details
      const imageHash = singlePhotoHash(request);
      if (imageHash !== undefined) {
        queryClient.invalidateQueries({ queryKey: photoKeys.detail(imageHash) });
      }
    },
  });
