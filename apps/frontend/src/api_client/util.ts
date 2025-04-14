import { useQuery } from '@tanstack/react-query';
import { z } from "zod";
import { fetchClient, QueryKeys } from "./api";

export const LocationSunburst = z.lazy(() =>
  z.object({
    name: z.string(),
    hex: z.string().optional(),
    children: z.array(LocationSunburst).optional(),
  })
);

export type LocationSunburst = z.infer<typeof LocationSunburst>;

export const CountStats = z.object({
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

export type CountStats = z.infer<typeof CountStats>;
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

export const WordCloudResponse = z.object({
  captions: WordCloud.array(),
  people: WordCloud.array(),
  locations: WordCloud.array(),
});

export type WordCloudResponse = z.infer<typeof WordCloudResponse>;

export const PhotoMonthCount = z.object({
  month: z.string(),
  count: z.number(),
});
export const PhotoMonthCountResponse = z.array(PhotoMonthCount);
export type PhotoMonthCountResponse = z.infer<typeof PhotoMonthCountResponse>;

export const Timezones = z.string().array();
export type Timezones = z.infer<typeof Timezones>;

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

export const useFetchLocationTreeQuery = () => useQuery({
  queryKey: [QueryKeys.locationTree],
  queryFn: async () => {
    const response = await fetchClient.get('/locationsunburst/');
    return LocationSunburst.parse(response);
  },
});

export const useFetchCountStatsQuery = () => useQuery({
  queryKey: [QueryKeys.countStats],
  queryFn: async () => {
    const response = await fetchClient.get('/stats/');
    return CountStats.parse(response);
  },
});

export const useFetchWordCloudQuery = () => useQuery({
  queryKey: [QueryKeys.wordCloud],
  queryFn: async () => {
    const response = await fetchClient.get('/wordcloud/');
    return WordCloudResponse.parse(response);
  },
});

export const useFetchPhotoMonthCountQuery = () => useQuery({
  queryKey: [QueryKeys.photoMonthCount],
  queryFn: async () => {
    const response = await fetchClient.get('/photomonthcounts/');
    return PhotoMonthCountResponse.parse(response);
  },
}); 