import { albumKeys, endpoints, faceKeys, invalidateAfter, photoKeys, statsKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

const DeleteFacesMutationKey = ["deleteFaces"] as const;

type DeleteFacesRequest = { faceIds: number[] };

const deleteFaces = (data: DeleteFacesRequest) => endpoints.deleteFaces(apiClient, data.faceIds);

export const useDeleteFacesMutation = () =>
  useMutation({
    mutationKey: DeleteFacesMutationKey,
    mutationFn: deleteFaces,
    // Only once the server confirmed: the dashboard and the lightbox used to say so right after
    // sending the request. A failure gets the QueryClient's "could not save" toast.
    onSuccess: (_data, { faceIds }) => {
      notification.deleteFaces(faceIds.length);
      // Face-related queries, people albums (face counts change), statistics (num_faces,
      // num_people, etc. change) and photo details (people array changes), after a short delay
      // so backend processing is complete.
      invalidateAfter(queryClient, [
        faceKeys.incomplete(),
        faceKeys.personFaces(),
        albumKeys.peopleAlbums(),
        statsKeys.counts(),
        photoKeys.details(),
      ]);
    },
  });
