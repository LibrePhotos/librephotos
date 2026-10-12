import { endpoints, invalidateAfter } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { PeopleAlbumsQueryKeys } from "../../albums/hooks/useFetchPeopleAlbumsQuery";
import { apiClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { FacesQueryKeys } from "./useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "./useFetchIncompleteFacesQuery";

const trainFaces = () => endpoints.trainFaces(apiClient);

export const useTrainFacesMutation = () =>
  useMutation({
    mutationFn: () => trainFaces(),
    onSuccess: () => {
      notification.trainFaces();
      // Faces clustering/training may change counts and labels
      invalidateAfter(queryClient, [
        IncompleteFacesQueryKeys,
        FacesQueryKeys,
        PeopleAlbumsQueryKeys,
        CountStatsQueryKeys,
      ]);
    },
    onError: () => {
      notification.trainFacesFailed();
    },
  });
