import { albumKeys, endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

type SetPersonAlbumCoverParams = {
  id: string;
  cover_photo: string;
};

export const useSetPersonAlbumCoverMutation = () =>
  useMutation({
    mutationFn: async ({ id, cover_photo }: SetPersonAlbumCoverParams) => {
      await endpoints.setPersonCover(apiClient, id, cover_photo);
      notification.setCoverPhoto();
    },
    onSuccess: () => {
      // Person album covers affect the people albums listing
      queryClient.invalidateQueries({ queryKey: albumKeys.peopleAlbums() });
    },
  });
