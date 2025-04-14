import { z } from "zod";
import { useQuery } from '@tanstack/react-query';
import { fetchClient, QueryKeys } from "./api";

export const LocationTimeline = z.array(
  z.object({
    data: z.array(z.number()),
    color: z.string(),
    loc: z.string(),
    start: z.number(),
    end: z.number(),
  })
);

export type LocationTimeline = z.infer<typeof LocationTimeline>;

export const useLocationTimelineQuery = () => useQuery({
  queryKey: [QueryKeys.locationTimeline],
  queryFn: async () => {
    const response = await fetchClient.get('locationtimeline/');
    return LocationTimeline.parse(response);
  },
}); 