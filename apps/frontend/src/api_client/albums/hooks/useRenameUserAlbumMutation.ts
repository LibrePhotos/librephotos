import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { albumKeys } from "../keys";
import type { RenameUserAlbumParams } from "../types";

export const useRenameUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ id, title, newTitle }: RenameUserAlbumParams) => {
      await fetchClient.patch(`/albums/user/${id}/`, { title: newTitle });
      notification.renameAlbum(title, newTitle);
    },
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(id) });
    },
  });
