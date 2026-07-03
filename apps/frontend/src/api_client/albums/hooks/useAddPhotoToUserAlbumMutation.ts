import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { AddPhotoFromUserAlbumParams } from "../types";
import { UserAlbumQueryKeys } from "./useFetchUserAlbumQuery";
import { UserAlbumsQueryKeys } from "./useFetchUserAlbumsQuery";

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
      await fetchClient.patch(`/albums/user/edit/${id}/`, body);
      notification.addPhotosToAlbum(title, photoCount ?? photos.length);
    },
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...UserAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...UserAlbumQueryKeys, id] });
    },
  });
