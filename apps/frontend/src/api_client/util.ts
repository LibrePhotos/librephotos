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

export const CountStatsSchema = z.object({
  num_photos: z.number(),
  num_missing_photos: z.number(),
  num_faces: z.number(),
  num_people: z.number(),
  num_unknown_faces: z.number(),
  num_labeled_faces: z.number(),
  num_inferred_faces: z.number(),
  num_albumauto: z.number(),
  num_albumdate: z.number(),
  num_albumuser: z.number(),
});

type CountStats = z.infer<typeof CountStatsSchema>;
export const COUNT_STATS_DEFAULTS: CountStats = {
  num_photos: 0,
  num_missing_photos: 0,
  num_faces: 0,
  num_people: 0,
  num_unknown_faces: 0,
  num_labeled_faces: 0,
  num_inferred_faces: 0,
  num_albumauto: 0,
  num_albumdate: 0,
  num_albumuser: 0,
};

export const WordCloud = z.object({
  label: z.string(),
  y: z.number(),
  x: z.number().optional(),
});

export const WordCloudResponseSchema = z.object({
  captions: WordCloud.array(),
  people: WordCloud.array(),
  locations: WordCloud.array(),
});

type WordCloudResponse = z.infer<typeof WordCloudResponseSchema>;

const PhotoMonthCountSchema = z.object({
  month: z.string(),
  count: z.number(),
});
const PhotoMonthCountResponseSchema = z.array(PhotoMonthCountSchema);
type PhotoMonthCountResponse = z.infer<typeof PhotoMonthCountResponseSchema>;

enum Endpoints {
  fetchTimezones = "fetchTimezones",
  fetchLocationTree = "fetchLocationTree",
  fetchCountStats = "fetchCountStats",
  fetchWordCloud = "fetchWordCloud",
  fetchPhotoMonthCount = "fetchPhotoMonthCount",
}

const TimezonesSchema = z.string().array();
type Timezones = z.infer<typeof TimezonesSchema>;

export const util = api
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
      [Endpoints.fetchCountStats]: builder.query<CountStats, void>({
        query: () => "stats/",
        transformResponse: response => CountStatsSchema.parse(response),
      }),
      [Endpoints.fetchWordCloud]: builder.query<WordCloudResponse, void>({
        query: () => "wordcloud/",
        async onQueryStarted(arg, { dispatch, queryFulfilled }) {
          /**
           * This is a workaround. For the time being we'll use redux store instead of cache.
           * The use of cached data is not working properly with Word Cloud component. This could be due to the timing.
           */
          dispatch({ type: "FETCH_WORDCLOUD" });
          try {
            const { data } = await queryFulfilled;
            const payload = WordCloudResponseSchema.parse(data);
            dispatch({ type: "FETCH_WORDCLOUD_FULFILLED", payload });
          } catch (error) {
            dispatch({ type: "FETCH_WORDCLOUD_REJECTED", payload: error });
          }
        },
      }),
      [Endpoints.fetchPhotoMonthCount]: builder.query<PhotoMonthCountResponse, void>({
        query: () => "photomonthcounts/",
        transformResponse: (response: PhotoMonthCountResponse) => PhotoMonthCountResponseSchema.parse(response),
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

export const {
  useFetchTimezonesQuery,
  useFetchLocationTreeQuery,
  useFetchCountStatsQuery,
  useFetchPhotoMonthCountQuery,
} = util;
