import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { albumKeys } from "../keys";
import type { DeleteUserAlbumParams } from "../types";

export const useDeleteUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ id, albumTitle }: DeleteUserAlbumParams) => {
      await fetchClient.delete(`/albums/user/${id}/`);
      notification.deleteAlbum(albumTitle);
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
    },
  });
