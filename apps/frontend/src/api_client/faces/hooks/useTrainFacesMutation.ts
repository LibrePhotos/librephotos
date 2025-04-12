import { useMutation } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { z } from "zod";

export type TrainFacesResponse = z.infer<typeof TrainFacesResponse>;
export const TrainFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const trainFaces = () => 
  fetchClient.post<TrainFacesResponse>('/trainfaces');

export const useTrainFacesMutation = () => {
  return useMutation({
    mutationFn: () => trainFaces(),
  });
}; 