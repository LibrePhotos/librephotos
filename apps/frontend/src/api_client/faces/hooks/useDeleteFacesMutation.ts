import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { PeopleAlbumsQueryKeys } from "../../albums/hooks/useFetchPeopleAlbumsQuery";
import { apiClient, queryClient } from "../../api";
import { PhotoDetailsQueryKeys } from "../../photos/hooks/useFetchPhotoDetailsQuery";
import { invalidateAfter } from "../../polling";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { FacesQueryKeys } from "./useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "./useFetchIncompleteFacesQuery";

const DeleteFacesQueryKeys = ["deleteFaces"];

type DeleteFacesRequest = { faceIds: number[] };

const deleteFaces = (data: DeleteFacesRequest) => endpoints.deleteFaces(apiClient, data.faceIds);

export const useDeleteFacesMutation = () =>
  useMutation({
    mutationKey: [...DeleteFacesQueryKeys],
    mutationFn: deleteFaces,
    onSuccess: () => {
      // Face-related queries, people albums (face counts change), statistics (num_faces,
      // num_people, etc. change) and photo details (people array changes), after a short delay
      // so backend processing is complete.
      invalidateAfter(queryClient, [
        IncompleteFacesQueryKeys,
        FacesQueryKeys,
        PeopleAlbumsQueryKeys,
        CountStatsQueryKeys,
        PhotoDetailsQueryKeys,
      ]);
    },
    onError: error => {
      console.error("Delete faces mutation error:", error);
    },
  });
