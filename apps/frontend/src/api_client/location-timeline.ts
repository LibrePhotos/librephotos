import { z } from "zod";
import { useQuery } from '@tanstack/react-query';
import { fetchClient, QueryKeys } from "./api";

const LocationTimelineSchema = z.array(
  z.object({
    data: z.array(z.number()),
    color: z.string(),
    loc: z.string(),
    start: z.number(),
    end: z.number(),
  })
);

type LocationTimeline = z.infer<typeof LocationTimelineSchema>;

export const useLocationTimelineQuery = () => useQuery({
  queryKey: [QueryKeys.locationTimeline],
  queryFn: async () => {
    const response = await fetchClient.get('locationtimeline/');
    return LocationTimelineSchema.parse(response);
  },
}); 