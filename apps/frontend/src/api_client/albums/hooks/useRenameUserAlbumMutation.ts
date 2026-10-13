import { albumKeys, endpoints, photoGridKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import type { RenameUserAlbumParams } from "../types";

export const useRenameUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ id, title, newTitle }: RenameUserAlbumParams) => {
      await endpoints.renameUserAlbum(apiClient, id, newTitle);
      notification.renameAlbum(title, newTitle);
    },
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(id) });
    },
  });
