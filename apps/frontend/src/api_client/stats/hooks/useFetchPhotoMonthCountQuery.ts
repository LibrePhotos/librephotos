import { useQuery } from '@tanstack/react-query';

import { fetchClient } from "../../api";
import { PhotoMonthCountResponse } from "../types";

export const PhotoMonthCountQueryKeys = ['photoMonthCount'] as const;

export const useFetchPhotoMonthCountQuery = () => useQuery({
  queryKey: [...PhotoMonthCountQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/photomonthcounts/');
    return PhotoMonthCountResponse.parse(response);
  },
}); 