import { z } from "zod";

import { SimpleUser } from "../store/user/user.zod";

export const Job = z.object({
  job_id: z.string(),
  queued_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  finished: z.boolean(),
  failed: z.boolean(),
  job_type: z.number(),
  job_type_str: z.string(),
  started_by: SimpleUser,
  error: z.any().optional(),
  result: z.object({
    progress: z.object({
      current: z.number().optional(),
      target: z.number().optional(),
    }),
  }),
  id: z.number(),
});

export type IJob = z.infer<typeof Job>;

export const JobRequestSchema = z.object({
  pageSize: z.number().optional(),
  page: z.number().optional(),
});

export type IJobRequestSchema = z.infer<typeof JobRequestSchema>;

export const JobsResponseSchema = z
  .object({
    count: z.number(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(Job),
  })
  .optional();

export type IJobsResponseSchema = z.infer<typeof JobsResponseSchema>;

interface DirTreeItem {
  title: string;
  absolutePath?: string;
  children?: DirTreeItem[];
}

// cast to z.ZodType<Category>
export const DirTree: z.ZodType<DirTreeItem> = z.lazy(() =>
  z.object({
    title: z.string(),
    absolutePath: z.string().optional(),
    children: z.array(DirTree).optional(),
  })
);

export const DeleteMissingPhotosResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const GenerateEventAlbumsResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const GenerateEventAlbumsTitlesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const SearchTermExamples = z.array(z.string());

interface LocationSunburstItem {
  name: string;
  hex?: string;
  children?: LocationSunburstItem[];
}

export const LocationSunburst: z.ZodType<LocationSunburstItem> = z.lazy(() =>
  z.object({
    name: z.string(),
    hex: z.string().optional(),
    children: z.array(LocationSunburst).optional(),
  })
);

export const TimelinePoint = z.object({
  data: z.array(z.number()),
  color: z.string(),
  loc: z.string(),
  start: z.number(),
  end: z.number(),
});

export const LocationTimeline = z.array(TimelinePoint);

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

export const PhotoMonthCount = z.object({
  month: z.string(),
  count: z.number(),
});

// To-Do: Why y?!?!
export const WordCloud = z.object({
  label: z.string(),
  y: z.number(),
});

export const WordCloudResponse = z.object({
  captions: WordCloud.array(),
  people: WordCloud.array(),
  locations: WordCloud.array(),
});
