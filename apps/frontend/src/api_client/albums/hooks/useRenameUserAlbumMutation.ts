import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";
import { RenameUserAlbumParams } from "../types";

export const useRenameUserAlbumMutation = () => useMutation({
  mutationFn: async ({ id, title, newTitle }: RenameUserAlbumParams) => {
    await fetchClient.patch(`/albums/user/${id}/`, { title: newTitle });
    notification.renameAlbum(title, newTitle);
  },
  onSuccess: (_, { id }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbum, id] });
  },
}); 