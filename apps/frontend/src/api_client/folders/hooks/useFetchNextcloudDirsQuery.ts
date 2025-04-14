import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { DirTreeResponse } from "../types";

export const useFetchNextcloudDirsQuery = () => useQuery({
  queryKey: [QueryKeys.nextcloudDirs],
  queryFn: async () => {
    const response = await fetchClient.get('nextcloud/listdir/?fpath=/');
    return DirTreeResponse.parse(response);
  },
}); 