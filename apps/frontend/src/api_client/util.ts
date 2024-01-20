import { z } from "zod";

import { api } from "./api";

enum Endpoints {
  fetchTimezones = "fetchTimezones",
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
    }),
  })
  .enhanceEndpoints<"Timezones">({
    addTagTypes: ["Timezones"],
    endpoints: {
      [Endpoints.fetchTimezones]: {
        providesTags: ["Timezones"],
      },
    },
  });

export const { useFetchTimezonesQuery } = utilApi;
