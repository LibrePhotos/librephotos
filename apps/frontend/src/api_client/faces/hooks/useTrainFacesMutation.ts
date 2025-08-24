import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { fetchClient } from "../../api";

export type TrainFacesResponse = z.infer<typeof TrainFacesResponse>;
export const TrainFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const trainFaces = () => fetchClient.post<TrainFacesResponse>("/trainfaces");

export const useTrainFacesMutation = () => useMutation({
    mutationFn: () => trainFaces(),
  });
