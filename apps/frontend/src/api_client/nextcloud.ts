import { useQuery } from '@tanstack/react-query';
import { fetchClient, QueryKeys } from "./api";
import { DirTreeResponseSchema } from "./dir-tree";

export const useFetchNextcloudDirsQuery = () => useQuery({
  queryKey: [QueryKeys.nextcloudDirs],
  queryFn: async () => {
    const response = await fetchClient.get('nextcloud/listdir/?fpath=/');
    return DirTreeResponseSchema.parse(response);
  },
}); 