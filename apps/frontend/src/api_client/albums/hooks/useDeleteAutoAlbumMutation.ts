import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";

type DeleteAutoAlbumParams = {
  id: string;
  albumTitle: string;
};

export const useDeleteAutoAlbumMutation = () => useMutation({
  mutationFn: async ({ id, albumTitle }: DeleteAutoAlbumParams) => {
    await fetchClient.delete(`/albums/auto/${id}/`);
    notification.deleteAlbum(albumTitle);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum] });
  }
}); 