import { albumKeys, endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";
import type { DeleteUserAlbumParams } from "../types";

export const useDeleteUserAlbumMutation = (options: MutationErrorOptions = {}) =>
  useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: async ({ id, albumTitle }: DeleteUserAlbumParams) => {
      await endpoints.deleteUserAlbum(apiClient, id);
      notification.deleteAlbum(albumTitle);
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
    },
  });
