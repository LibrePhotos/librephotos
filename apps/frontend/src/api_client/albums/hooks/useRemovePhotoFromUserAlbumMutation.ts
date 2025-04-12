import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";
import { RemovePhotoFromUserAlbumParams } from "../types";

export const useRemovePhotoFromUserAlbumMutation = () => useMutation({
  mutationFn: async ({ id, title, photos }: RemovePhotoFromUserAlbumParams) => {
    await fetchClient.patch(`/albums/user/edit/${id}/`, { removedPhotos: photos });
    notification.removePhotosFromAlbum(title, photos.length);
  },
  onSuccess: (_, { id }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbum, id] });
  },
}); 