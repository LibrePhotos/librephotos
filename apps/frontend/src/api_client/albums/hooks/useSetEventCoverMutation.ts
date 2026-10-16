import { albumKeys, endpoints, photoGridKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";

type SetEventCoverParams = {
  id: string;
  /** A photo id of the event, or null for the automatic cover (#429). */
  photo: string | null;
};

/** Picks the cover the Events list shows for an event, or goes back to the automatic one. */
export const useSetEventCoverMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, photo }: SetEventCoverParams) => endpoints.setAutoAlbumCover(apiClient, id, photo),
    onSuccess: (_, { id }) => {
      notification.setCoverPhoto();
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: albumKeys.autoAlbums() }),
        queryClient.invalidateQueries({ queryKey: photoGridKeys.autoAlbum(id) }),
      ]);
    },
  });
};
