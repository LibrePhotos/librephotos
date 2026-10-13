import { endpoints } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";
import { invalidateUserAlbumPhotos } from "../invalidateUserAlbumPhotos";
import type { DeleteUserAlbumParams } from "../types";

export const useDeleteUserAlbumMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: async ({ id, albumTitle }: DeleteUserAlbumParams) => {
      await endpoints.deleteUserAlbum(apiClient, id);
      notification.deleteAlbum(albumTitle);
    },
    onSuccess: () => invalidateUserAlbumPhotos(queryClient),
  });
};
