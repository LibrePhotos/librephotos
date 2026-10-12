import { z } from "zod";

/*
 * The statistics views (api/views/dataviz.py, built in api/dataviz/stats.py and
 * api/faces/social_graph.py). They answer plain dicts and lists and declare no
 * response serializer.
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

/** One node of the location tree (`GET /locationsunburst/`, the sunburst chart): a place and the places in it. */
export type LocationSunburst = {
  name: string;
  hex?: string;
  children?: LocationSunburst[];
};

export const LocationSunburst: z.ZodType<LocationSunburst> = z.lazy(() =>
  z.object({
    name: z.string(),
    hex: z.string().optional(),
    children: z.array(LocationSunburst).optional(),
  })
);

const WordCloudEntry = z.object({
  label: z.string(),
  y: z.number(),
  x: z.number().optional(),
});

/** `GET /wordcloud/`: the most frequent caption words, people and places, each with its count. */
export const WordCloudResponse = z.object({
  captions: WordCloudEntry.array(),
  people: WordCloudEntry.array(),
  locations: WordCloudEntry.array(),
});
export type WordCloudResponse = z.infer<typeof WordCloudResponse>;

/** `GET /photomonthcounts/`: how many photos each month has ("YYYY-MM"). */
export const PhotoMonthCountResponse = z.array(
  z.object({
    month: z.string(),
    count: z.number(),
  })
);
export type PhotoMonthCountResponse = z.infer<typeof PhotoMonthCountResponse>;

/** `GET /locationtimeline/`: the stretches of time spent in each place, for the stacked bar. */
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
