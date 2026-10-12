import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { albumKeys } from "../keys";
import type { CreateUserAlbumParams } from "../types";

export const useCreateUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ title, photos, select_all, query, excluded_hashes, photoCount }: CreateUserAlbumParams) => {
      const selectAll = select_all ? { query, excludedHashes: excluded_hashes } : undefined;
      await endpoints.createUserAlbum(apiClient, title, photos, selectAll);
      notification.createAlbum(title, photoCount ?? photos.length);
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
    },
  });
