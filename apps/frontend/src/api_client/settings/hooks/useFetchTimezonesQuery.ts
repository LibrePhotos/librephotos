import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { Timezones } from "../types";

export const useFetchTimezonesQuery = () => useQuery({
  queryKey: [QueryKeys.timezones],
  queryFn: async () => {
    const response = await fetchClient.get<string>('/timezones/');
    try {
      const timezones = JSON.parse(response);
      return Timezones.parse(timezones);
    } catch (e) {
      return [];
    }
  },
}); 