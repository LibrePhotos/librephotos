import { useQuery } from '@tanstack/react-query';

import { fetchClient } from "../../api";
import { DirTreeResponse } from "../types";

export const DirsQueryKeys = ['dirtree'] as const;

export const useFetchDirsQuery = (path: string) => 
  useQuery({
    queryKey: [...DirsQueryKeys, path],
    queryFn: async () => {
      const response = await fetchClient.get(`/dirtree/?path=${path}`);
      return DirTreeResponse.parse(response);
    },
  }); 