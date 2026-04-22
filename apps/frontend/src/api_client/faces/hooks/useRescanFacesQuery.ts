import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { fetchClient } from "../../api";

export type ScanFacesResponse = z.infer<typeof ScanFacesResponse>;
export const ScanFacesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const RescanFacesQueryKeys = ["rescanFaces"];

const rescanFaces = () => fetchClient.get<ScanFacesResponse>("/scanfaces");

export const useRescanFacesQuery = () =>
  useQuery({
    queryKey: [...RescanFacesQueryKeys],
    queryFn: () => rescanFaces(),
  });
