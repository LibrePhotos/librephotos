import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";
import { SetUserAlbumCoverParams } from "../types";

export const useSetUserAlbumCoverMutation = () => useMutation({
  mutationFn: async ({ id, photo }: SetUserAlbumCoverParams) => {
    await fetchClient.patch(`/albums/user/edit/${id}/`, { cover_photo: photo });
    notification.setCoverPhoto();
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
  },
}); 