import { z } from "zod";

import { api } from "./api";

export const LocationSunburstSchema = z.lazy(() =>
  z.object({
    name: z.string(),
    hex: z.string().optional(),
    children: z.array(LocationSunburstSchema).optional(),
  })
);

type LocationSunburst = z.infer<typeof LocationSunburstSchema>;

enum Endpoints {
  fetchTimezones = "fetchTimezones",
  fetchLocationTree = "fetchLocationTree",
}

const TimezonesSchema = z.string().array();
type Timezones = z.infer<typeof TimezonesSchema>;

const utilApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchTimezones]: builder.query<Timezones, void>({
        query: () => "timezones/",
        transformResponse: (response: string) => {
          try {
            const timezones = JSON.parse(response);
            return TimezonesSchema.parse(timezones);
          } catch (e) {
            return [];
          }
        },
      }),
      [Endpoints.fetchLocationTree]: builder.query<LocationSunburst, void>({
        query: () => "locationsunburst/",
        transformResponse: response => LocationSunburstSchema.parse(response),
      }),
    }),
  })
  .enhanceEndpoints<"Timezones" | "LocationTree">({
    addTagTypes: ["Timezones", "LocationTree"],
    endpoints: {
      [Endpoints.fetchTimezones]: {
        providesTags: ["Timezones"],
      },
      [Endpoints.fetchLocationTree]: {
        providesTags: ["LocationTree"],
      },
    },
  });

export const { useFetchTimezonesQuery, useFetchLocationTreeQuery } = utilApi;
