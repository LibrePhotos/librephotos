import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { PeopleAlbumsQueryKeys } from "../../albums/hooks/useFetchPeopleAlbumsQuery";
import { apiClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { FacesQueryKeys } from "./useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "./useFetchIncompleteFacesQuery";

export { JobTriggerResponse as TrainFacesResponse } from "@librephotos/api-client";

export const trainFaces = () => endpoints.trainFaces(apiClient);

export const useTrainFacesMutation = () =>
  useMutation({
    mutationFn: () => trainFaces(),
    onSuccess: () => {
      notification.trainFaces();
      // Faces clustering/training may change counts and labels
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: IncompleteFacesQueryKeys });
        queryClient.invalidateQueries({ queryKey: FacesQueryKeys });
        queryClient.invalidateQueries({ queryKey: PeopleAlbumsQueryKeys });
        queryClient.invalidateQueries({ queryKey: CountStatsQueryKeys });
      }, 100);
    },
    onError: () => {
      notification.trainFacesFailed();
    },
  });
