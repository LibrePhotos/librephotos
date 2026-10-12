import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { albumKeys } from "../keys";
import type { AddPhotoFromUserAlbumParams } from "../types";

export const useAddPhotoToUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({
      id,
      title,
      photos,
      select_all,
      query,
      excluded_hashes,
      photoCount,
    }: AddPhotoFromUserAlbumParams) => {
      const body = select_all
        ? { title, photos: [], select_all: true, query: query ?? {}, excluded_hashes: excluded_hashes ?? [] }
        : { title, photos };
      await apiClient.patch(`/albums/user/edit/${id}/`, body);
      notification.addPhotosToAlbum(title, photoCount ?? photos.length);
    },
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(id) });
    },
  });
