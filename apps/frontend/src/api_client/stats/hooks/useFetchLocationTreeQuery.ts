import { useQuery } from '@tanstack/react-query';

import { fetchClient } from "../../api";
import { LocationSunburst } from "../types";

export const LocationTreeQueryKeys = ['locationTree'] as const;

export const useFetchLocationTreeQuery = () => useQuery({
  queryKey: [...LocationTreeQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/locationsunburst/');
    return LocationSunburst.parse(response);
  },
}); 