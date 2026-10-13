import { endpoints } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidateUserAlbumPhotos } from "../invalidateUserAlbumPhotos";
import type { CreateUserAlbumParams } from "../types";

export const useCreateUserAlbumMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ title, photos, select_all, query, excluded_hashes, photoCount }: CreateUserAlbumParams) => {
      const selectAll = select_all ? { query, excludedHashes: excluded_hashes } : undefined;
      await endpoints.createUserAlbum(apiClient, title, photos, selectAll);
      notification.createAlbum(title, photoCount ?? photos.length);
    },
    onSuccess: () => invalidateUserAlbumPhotos(queryClient),
  });
};
