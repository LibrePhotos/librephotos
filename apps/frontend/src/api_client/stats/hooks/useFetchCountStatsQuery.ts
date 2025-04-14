import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { CountStats } from "../types";

export const useFetchCountStatsQuery = () => useQuery({
  queryKey: [QueryKeys.countStats],
  queryFn: async () => {
    const response = await fetchClient.get('/stats/');
    return CountStats.parse(response);
  },
}); 