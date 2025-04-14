import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { PhotoMonthCountResponse } from "../types";

export const useFetchPhotoMonthCountQuery = () => useQuery({
  queryKey: [QueryKeys.photoMonthCount],
  queryFn: async () => {
    const response = await fetchClient.get('/photomonthcounts/');
    return PhotoMonthCountResponse.parse(response);
  },
}); 