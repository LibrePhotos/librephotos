import { z } from "zod";

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

export const Node = z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
  });
  
  export const Link = z.object({
    source: z.string(),
    target: z.string(),
  });
  
  export const PersonDataPointList = z.object({
    nodes: Node.array(),
    links: Link.array(),
  });
  
  export type PersonDataPointList = z.infer<typeof PersonDataPointList>;
  
  