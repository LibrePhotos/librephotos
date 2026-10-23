import { albumKeys, endpoints, photoGridKeys } from "@librephotos/api-client";
import type { AlbumRole } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";

type ShareUserAlbumParams = {
  albumId: string;
  userId: string;
  share: boolean;
  /** What the user may do (#464); leaving the contributors takes their photos out of the album. */
  role?: AlbumRole;
};

export const useShareUserAlbumMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ albumId, userId, share, role }: ShareUserAlbumParams) => {
      await endpoints.setUserAlbumShared(apiClient, albumId, userId, share, role);
      notification.toggleAlbumSharing(share);
    },
    onSuccess: (_, { albumId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() }),
        queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(albumId) }),
        queryClient.invalidateQueries({ queryKey: albumKeys.sharedByMe() }),
        queryClient.invalidateQueries({ queryKey: albumKeys.sharedWithMe() }),
      ]),
  });
};
