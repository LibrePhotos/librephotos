import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { LocationSunburst } from "../types";

export const useFetchLocationTreeQuery = () => useQuery({
  queryKey: [QueryKeys.locationTree],
  queryFn: async () => {
    const response = await fetchClient.get('/locationsunburst/');
    return LocationSunburst.parse(response);
  },
}); 