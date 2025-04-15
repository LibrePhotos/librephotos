import { useQuery } from '@tanstack/react-query';

import { fetchClient } from "../../api";
import { DirTreeResponse } from "../types";

export const NextcloudDirsQueryKeys = ['nextcloudDirs'] as const;

export const useFetchNextcloudDirsQuery = () => useQuery({
  queryKey: [...NextcloudDirsQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/nextcloud/listdir/?fpath=/');
    return DirTreeResponse.parse(response);
  },
}); 