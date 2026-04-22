import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { AutoAlbumQueryKeys } from "./useFetchAutoAlbumQuery";
import { AutoAlbumsQueryKeys } from "./useFetchAutoAlbumsQuery";

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
      queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...AutoAlbumQueryKeys] });
    },
  });
