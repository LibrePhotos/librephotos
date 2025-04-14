import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { LocationTimeline } from "../types";

export const useLocationTimelineQuery = () => useQuery({
  queryKey: [QueryKeys.locationTimeline],
  queryFn: async () => {
    const response = await fetchClient.get('/locationtimeline/');
    return LocationTimeline.parse(response);
  },
}); 