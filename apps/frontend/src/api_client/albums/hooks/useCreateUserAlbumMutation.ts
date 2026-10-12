import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { albumKeys } from "../keys";
import type { CreateUserAlbumParams } from "../types";

export const useCreateUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ title, photos, select_all, query, excluded_hashes, photoCount }: CreateUserAlbumParams) => {
      const body = select_all
        ? { title, photos: [], select_all: true, query: query ?? {}, excluded_hashes: excluded_hashes ?? [] }
        : { title, photos };
      await fetchClient.post(`/albums/user/edit/`, body);
      notification.createAlbum(title, photoCount ?? photos.length);
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
    },
  });
