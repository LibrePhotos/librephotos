import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";

type ShareUserAlbumParams = {
  albumId: string;
  userId: string;
  share: boolean;
};

export const useShareUserAlbumMutation = () => useMutation({
  mutationFn: async ({ albumId, userId, share }: ShareUserAlbumParams) => {
    await fetchClient.post('/useralbum/share/', { 
      shared: share, 
      album_id: albumId, 
      target_user_id: userId 
    });
    notification.toggleAlbumSharing(share);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbum] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.sharedAlbumsByMe] });
  },
}); 