import { endpoints } from "@librephotos/api-client";
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
      const selectAll = select_all ? { query, excludedHashes: excluded_hashes } : undefined;
      await endpoints.addPhotosToUserAlbum(apiClient, id, title, photos, selectAll);
      notification.addPhotosToAlbum(title, photoCount ?? photos.length);
    },
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(id) });
    },
  });
