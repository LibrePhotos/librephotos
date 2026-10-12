import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { albumKeys } from "../keys";

type ShareUserAlbumParams = {
  albumId: string;
  userId: string;
  share: boolean;
};

export const useShareUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ albumId, userId, share }: ShareUserAlbumParams) => {
      await endpoints.setUserAlbumShared(apiClient, albumId, userId, share);
      notification.toggleAlbumSharing(share);
    },
    onSuccess: (_, { albumId }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(albumId) });
      queryClient.invalidateQueries({ queryKey: albumKeys.sharedByMe() });
      queryClient.invalidateQueries({ queryKey: albumKeys.sharedWithMe() });
    },
  });
