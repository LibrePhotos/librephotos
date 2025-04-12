import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";
import { CreateUserAlbumParams } from "../types";

export const useCreateUserAlbumMutation = () => useMutation({
  mutationFn: async ({ title, photos }: CreateUserAlbumParams) => {
    await fetchClient.post(`/albums/user/edit/`, { title, photos });
    notification.createAlbum(title, photos.length);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
  },
}); 