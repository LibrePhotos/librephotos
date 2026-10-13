import { endpoints } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidateUserAlbumPhotos } from "../invalidateUserAlbumPhotos";
import type { RemovePhotoFromUserAlbumParams } from "../types";

export const useRemovePhotoFromUserAlbumMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title, photos }: RemovePhotoFromUserAlbumParams) => {
      await endpoints.removePhotosFromUserAlbum(apiClient, id, photos);
      notification.removePhotosFromAlbum(title, photos.length);
    },
    onSuccess: (_, { id }) => invalidateUserAlbumPhotos(queryClient, id),
  });
};
