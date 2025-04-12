import { useQuery } from '@tanstack/react-query';
import { z } from "zod";
import { fetchClient, QueryKeys } from "./api";

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

const TimezonesSchema = z.string().array();
type Timezones = z.infer<typeof TimezonesSchema>;

export const useFetchTimezonesQuery = () => useQuery({
  queryKey: [QueryKeys.timezones],
  queryFn: async () => {
    const response = await fetchClient.get<string>('/timezones/');
    try {
      const timezones = JSON.parse(response);
      return TimezonesSchema.parse(timezones);
    } catch (e) {
      return [];
    }
  },
});

export const useFetchLocationTreeQuery = () => useQuery({
  queryKey: [QueryKeys.locationTree],
  queryFn: async () => {
    const response = await fetchClient.get('/locationsunburst/');
    return LocationSunburstSchema.parse(response);
  },
});

export const useFetchCountStatsQuery = () => useQuery({
  queryKey: [QueryKeys.countStats],
  queryFn: async () => {
    const response = await fetchClient.get('/stats/');
    return CountStatsSchema.parse(response);
  },
});

export const useFetchWordCloudQuery = () => useQuery({
  queryKey: [QueryKeys.wordCloud],
  queryFn: async () => {
    const response = await fetchClient.get('/wordcloud/');
    return WordCloudResponseSchema.parse(response);
  },
});

export const useFetchPhotoMonthCountQuery = () => useQuery({
  queryKey: [QueryKeys.photoMonthCount],
  queryFn: async () => {
    const response = await fetchClient.get('/photomonthcounts/');
    return PhotoMonthCountResponseSchema.parse(response);
  },
}); 