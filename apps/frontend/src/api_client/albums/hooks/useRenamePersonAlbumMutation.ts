import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { faceKeys } from "../../faces/keys";
import { statsKeys } from "../../stats/keys";
import { albumKeys } from "../keys";

type RenamePersonAlbumParams = {
  id: string;
  personName: string;
  newPersonName: string;
};

export const useRenamePersonAlbumMutation = () =>
  useMutation({
    mutationFn: async ({ id, personName, newPersonName }: RenamePersonAlbumParams) => {
      await apiClient.patch(`/persons/${id}/`, { newPersonName });
      notification.renamePerson(personName, newPersonName);
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: albumKeys.peopleAlbums() });
      queryClient.invalidateQueries({ queryKey: faceKeys.personFaces() });
      queryClient.invalidateQueries({ queryKey: faceKeys.incomplete() });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
    },
  });
