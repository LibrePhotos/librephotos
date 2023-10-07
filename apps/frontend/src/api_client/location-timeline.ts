import { z } from "zod";

import { api } from "./api";

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

enum LocationTimelineEndpoints {
  locationTimeline = "locationTimeline",
}

export const locationTimelineApi = api.injectEndpoints({
  endpoints: builder => ({
    [LocationTimelineEndpoints.locationTimeline]: builder.query<LocationTimeline, void>({
      query: () => "locationtimeline/",
      transformResponse: (response: LocationTimeline) => LocationTimelineSchema.parse(response),
    }),
  }),
});

export const { useLocationTimelineQuery } = locationTimelineApi;
