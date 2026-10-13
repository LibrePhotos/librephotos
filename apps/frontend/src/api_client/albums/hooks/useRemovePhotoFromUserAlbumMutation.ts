import { albumKeys, endpoints, photoGridKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import type { RemovePhotoFromUserAlbumParams } from "../types";

export const useRemovePhotoFromUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ id, title, photos }: RemovePhotoFromUserAlbumParams) => {
      await endpoints.removePhotosFromUserAlbum(apiClient, id, photos);
      notification.removePhotosFromAlbum(title, photos.length);
    },
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(id) });
    },
  });
