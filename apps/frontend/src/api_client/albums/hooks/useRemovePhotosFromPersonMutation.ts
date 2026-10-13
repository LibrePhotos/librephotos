import { albumKeys, endpoints, faceKeys, photoGridKeys, photoKeys, Photoset, statsKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";

type RemovePhotosFromPersonParams = {
  personId: string;
  personName: string;
  /** `Photo.id` of each photo. */
  photoIds: string[];
};

/**
 * Take a person off photos from the person page: their faces on them go back to unknown, so the
 * photos leave the page, the person's count drops and the faces show up in the face dashboard.
 */
export const useRemovePhotosFromPersonMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ personId, photoIds }: RemovePhotosFromPersonParams) =>
      endpoints.removePhotosFromPerson(apiClient, personId, photoIds),
    onSuccess: (result, { personName }) => {
      notification.removePhotosFromPerson(personName, result.photo_count);
      if (result.write_error) notification.faceTagsNotWritten(result.write_error);
      return Promise.all(
        [
          photoGridKeys.dateAlbumLists(Photoset.PERSON),
          photoGridKeys.dateAlbumDays(Photoset.PERSON),
          albumKeys.peopleAlbums(),
          faceKeys.personFaces(),
          faceKeys.incomplete(),
          statsKeys.counts(),
          photoKeys.details(),
        ].map(queryKey => queryClient.invalidateQueries({ queryKey }))
      );
    },
  });
};
