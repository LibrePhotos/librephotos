import { useQuery } from '@tanstack/react-query';
import { z } from "zod";
import { fetchClient, QueryKeys } from "./api";

export interface DirTree {
  title: string;
  absolute_path: string;
  children: DirTree[];
}

export type DirTreeResponse = DirTree[];

export const DirTreeSchema: z.ZodType<DirTree> = z.lazy(() =>
  z.object({
    title: z.string(),
    absolute_path: z.string(),
    children: z.array(DirTreeSchema),
  })
);

export const DirTreeResponseSchema: z.ZodType<DirTreeResponse> = z.array(DirTreeSchema);

export const useFetchDirsQuery = (path: string) => 
  useQuery({
    queryKey: [QueryKeys.nextcloudDirs, path],
    queryFn: async () => {
      const response = await fetchClient.get(`/dirtree/?path=${path}`);
      return DirTreeResponseSchema.parse(response);
    },
  }); 