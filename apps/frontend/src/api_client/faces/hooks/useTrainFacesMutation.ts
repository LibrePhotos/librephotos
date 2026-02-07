import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { PeopleAlbumsQueryKeys } from "../../albums/hooks/useFetchPeopleAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { FacesQueryKeys } from "./useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "./useFetchIncompleteFacesQuery";

export type TrainFacesResponse = z.infer<typeof TrainFacesResponse>;
export const TrainFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const trainFaces = () => fetchClient.post<TrainFacesResponse>("/trainfaces");

export const useTrainFacesMutation = () =>
  useMutation({
    mutationFn: () => trainFaces(),
    onSuccess: () => {
      // Faces clustering/training may change counts and labels
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: IncompleteFacesQueryKeys });
        queryClient.invalidateQueries({ queryKey: FacesQueryKeys });
        queryClient.invalidateQueries({ queryKey: PeopleAlbumsQueryKeys });
        queryClient.invalidateQueries({ queryKey: CountStatsQueryKeys });
      }, 100);
    },
  });
