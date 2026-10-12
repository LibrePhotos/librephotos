import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { faceKeys } from "../../faces/keys";
import { statsKeys } from "../../stats/keys";
import { albumKeys } from "../keys";

export const useDeletePersonAlbumMutation = () =>
  useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/persons/${id}/`);
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
