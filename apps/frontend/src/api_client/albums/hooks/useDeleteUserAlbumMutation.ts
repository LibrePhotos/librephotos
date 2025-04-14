import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { UserAlbumsQueryKeys } from './useFetchUserAlbumsQuery';
import { DeleteUserAlbumParams } from "../types";

export const useDeleteUserAlbumMutation = () => useMutation({
  mutationFn: async ({ id, albumTitle }: DeleteUserAlbumParams) => {
    await fetchClient.delete(`/albums/user/${id}/`);
    notification.deleteAlbum(albumTitle);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [...UserAlbumsQueryKeys] });
  },
}); 