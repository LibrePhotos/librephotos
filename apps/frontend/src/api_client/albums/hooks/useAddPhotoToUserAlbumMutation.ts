import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { AddPhotoFromUserAlbumParams } from "../types";
import { UserAlbumQueryKeys } from "./useFetchUserAlbumQuery";
import { UserAlbumsQueryKeys } from "./useFetchUserAlbumsQuery";

export const useAddPhotoToUserAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ id, title, photos }: AddPhotoFromUserAlbumParams) => {
      await fetchClient.patch(`/albums/user/edit/${id}/`, { title, photos });
      notification.addPhotosToAlbum(title, photos.length);
    },
    onSuccess: (_, { id }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...UserAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...UserAlbumQueryKeys, id] });
    },
  });
