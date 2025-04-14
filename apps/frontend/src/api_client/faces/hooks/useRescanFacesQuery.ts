import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { z } from 'zod';


export type ScanFacesResponse = z.infer<typeof ScanFacesResponse>;
export const ScanFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const RescanFacesQueryKeys = ["rescanFaces"];

const rescanFaces = () => fetchClient.get<ScanFacesResponse>('/scanfaces')

export const useRescanFacesQuery = () => {
  return useQuery({
    queryKey: [...RescanFacesQueryKeys],
    queryFn: () => rescanFaces(),
  });
}; 