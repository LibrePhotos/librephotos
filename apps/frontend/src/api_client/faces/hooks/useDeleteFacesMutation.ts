import { endpoints, invalidateAfter } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { albumKeys } from "../../albums/keys";
import { apiClient, queryClient } from "../../api";
import { photoKeys } from "../../photos/keys";
import { statsKeys } from "../../stats/keys";
import { faceKeys } from "../keys";

const DeleteFacesMutationKey = ["deleteFaces"] as const;

type DeleteFacesRequest = { faceIds: number[] };

const deleteFaces = (data: DeleteFacesRequest) => endpoints.deleteFaces(apiClient, data.faceIds);

export const useDeleteFacesMutation = () =>
  useMutation({
    mutationKey: DeleteFacesMutationKey,
    mutationFn: deleteFaces,
    onSuccess: () => {
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
    onError: error => {
      console.error("Delete faces mutation error:", error);
    },
  });
