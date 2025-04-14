import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { UserAlbumsQueryKeys } from './useFetchUserAlbumsQuery';
import { UserAlbumQueryKeys } from './useFetchUserAlbumQuery';
import { RenameUserAlbumParams } from "../types";

export const useRenameUserAlbumMutation = () => useMutation({
  mutationFn: async ({ id, title, newTitle }: RenameUserAlbumParams) => {
    await fetchClient.patch(`/albums/user/${id}/`, { title: newTitle });
    notification.renameAlbum(title, newTitle);
  },
  onSuccess: (_, { id }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [...UserAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...UserAlbumQueryKeys, id] });
  },
}); 