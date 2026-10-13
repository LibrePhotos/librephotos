import { albumKeys, endpoints, faceKeys, statsKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

export const useDeletePersonAlbumMutation = () =>
  useMutation({
    mutationFn: async (id: string) => {
      await endpoints.deletePerson(apiClient, id);
      notification.deletePerson();
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.peopleAlbums() });
      queryClient.invalidateQueries({ queryKey: faceKeys.personFaces() });
      queryClient.invalidateQueries({ queryKey: faceKeys.incomplete() });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
    },
  });
