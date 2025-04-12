import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";
import { AddPhotoFromUserAlbumParams } from "../types";

export const useAddPhotoToUserAlbumMutation = () => useMutation({
  mutationFn: async ({ id, title, photos }: AddPhotoFromUserAlbumParams) => {
    await fetchClient.patch(`/albums/user/edit/${id}/`, { title, photos });
    notification.addPhotosToAlbum(title, photos.length);
  },
  onSuccess: (_, { id }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbum, id] });
  },
}); 