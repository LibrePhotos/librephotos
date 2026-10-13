import { endpoints } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidateUserAlbumPhotos } from "../invalidateUserAlbumPhotos";
import type { AddPhotoFromUserAlbumParams } from "../types";

export const useAddPhotoToUserAlbumMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      title,
      photos,
      select_all,
      query,
      excluded_hashes,
      photoCount,
    }: AddPhotoFromUserAlbumParams) => {
      const selectAll = select_all ? { query, excludedHashes: excluded_hashes } : undefined;
      await endpoints.addPhotosToUserAlbum(apiClient, id, title, photos, selectAll);
      notification.addPhotosToAlbum(title, photoCount ?? photos.length);
    },
    onSuccess: (_, { id }) => invalidateUserAlbumPhotos(queryClient, id),
  });
};
