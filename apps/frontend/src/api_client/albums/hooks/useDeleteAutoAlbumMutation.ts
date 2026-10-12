import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { albumKeys } from "../keys";

type DeleteAutoAlbumParams = {
  id: string;
  albumTitle: string;
};

export const useDeleteAutoAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ id, albumTitle }: DeleteAutoAlbumParams) => {
      await fetchClient.delete(`/albums/auto/${id}/`);
      notification.deleteAlbum(albumTitle);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: albumKeys.autoAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("autoAlbum") });
    },
  });
