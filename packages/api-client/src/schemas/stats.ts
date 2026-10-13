import { z } from "zod";

/*
 * The statistics views (api/views/dataviz.py, built in api/dataviz/stats.py and
 * api/faces/social_graph.py). They answer plain dicts and lists; their response
 * serializers are in api/serializers/stats.py.
 */

/** `GET /stats/`: the counts on the library page and the statistics overview. */
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

/**
 * One node of the location tree (`GET /locationsunburst/`, the sunburst chart): a place and the
 * places in it. A leaf has no children but its photo count (`value`, api/dataviz/stats.py).
 */
export type LocationSunburst = {
  name: string;
  hex?: string;
  value?: number;
  children?: LocationSunburst[];
};

export const LocationSunburst: z.ZodType<LocationSunburst> = z.lazy(() =>
  z.object({
    name: z.string(),
    hex: z.string().optional(),
    value: z.number().optional(),
    children: z.array(LocationSunburst).optional(),
  })
);

/** A label and the natural log of its count. */
const WordCloudEntry = z.object({
  label: z.string(),
  y: z.number(),
});

/** `GET /wordcloud/`: the most frequent caption words, people and places, each with its count. */
export const WordCloudResponse = z.object({
  captions: WordCloudEntry.array(),
  people: WordCloudEntry.array(),
  locations: WordCloudEntry.array(),
});
export type WordCloudResponse = z.infer<typeof WordCloudResponse>;

/** One month of `GET /photomonthcounts/`: "YYYY-M" (not zero-padded) and its photo count. */
export const PhotoMonthCount = z.object({
  month: z.string(),
  count: z.number(),
});

/** `GET /photomonthcounts/`: how many photos each month has, every month from the first to the last. */
export const PhotoMonthCountResponse = z.array(PhotoMonthCount);
export type PhotoMonthCountResponse = z.infer<typeof PhotoMonthCountResponse>;

/** One stretch of `GET /locationtimeline/`: `data` holds its duration in seconds, `start`/`end` are Unix times. */
export const LocationTimelineSpan = z.object({
  data: z.array(z.number()),
  color: z.string(),
  loc: z.string(),
  start: z.number(),
  end: z.number(),
});

/** `GET /locationtimeline/`: the stretches of time spent in each place, for the stacked bar. */
export const LocationTimeline = z.array(LocationTimelineSpan);
export type LocationTimeline = z.infer<typeof LocationTimeline>;

/** `GET /socialgraph/`: people (by name) laid out on a plane, linked when they share a photo. */
export const SocialGraph = z.object({
  nodes: z
    .object({
      id: z.string(),
      x: z.number(),
      y: z.number(),
    })
    .array(),
  links: z
    .object({
      source: z.string(),
      target: z.string(),
    })
    .array(),
});
export type SocialGraph = z.infer<typeof SocialGraph>;
