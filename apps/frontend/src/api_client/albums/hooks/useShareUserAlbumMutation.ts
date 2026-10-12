import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
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
      await fetchClient.post("/useralbum/share/", {
        shared: share,
        album_id: albumId,
        target_user_id: userId,
      });
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
