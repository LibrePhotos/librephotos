import { useQuery } from '@tanstack/react-query';

import { fetchClient } from "../../api";
import { Timezones } from "../types";

export const TimezonesQueryKeys = ['timezones'] as const;

export const useFetchTimezonesQuery = () => useQuery({
  queryKey: [...TimezonesQueryKeys],
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