import { albumKeys, endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import type { SetUserAlbumCoverParams } from "../types";

export const useSetUserAlbumCoverMutation = () =>
  useMutation({
    mutationFn: async ({ id, photo }: SetUserAlbumCoverParams) => {
      await endpoints.setUserAlbumCover(apiClient, id, photo);
      notification.setCoverPhoto();
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
    },
  });
