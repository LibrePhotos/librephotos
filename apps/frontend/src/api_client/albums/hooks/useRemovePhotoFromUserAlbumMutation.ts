import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { albumKeys } from "../keys";
import type { RemovePhotoFromUserAlbumParams } from "../types";

export const useRemovePhotoFromUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ id, title, photos }: RemovePhotoFromUserAlbumParams) => {
      await apiClient.patch(`/albums/user/edit/${id}/`, { removedPhotos: photos });
      notification.removePhotosFromAlbum(title, photos.length);
    },
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(id) });
    },
  });
