import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { albumKeys } from "../keys";
import type { SetUserAlbumCoverParams } from "../types";

export const useSetUserAlbumCoverMutation = () =>
  useMutation({
    mutationFn: async ({ id, photo }: SetUserAlbumCoverParams) => {
      await apiClient.patch(`/albums/user/edit/${id}/`, { cover_photo: photo });
      notification.setCoverPhoto();
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
    },
  });
