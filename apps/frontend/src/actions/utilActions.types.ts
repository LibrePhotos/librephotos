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
  result: z.object({}),
  id: z.number(),
});

export const JobRequestSchema = z.object({
  pageSize: z.number(),
  page: z.number(),
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

export const WorkerAvailability = z.object({
  job_detail: Job.nullable(),
  queue_can_accept_job: z.boolean(),
  status: z.boolean(),
});

export const SiteSettings = z.object({
  allow_registration: z.boolean(),
  allow_upload: z.boolean(),
  skip_patterns: z.string(),
  heavyweight_process: z.number(),
  map_api_key: z.string(),
});

interface DirTree {
  title: string;
  absolutePath?: string;
  children?: DirTree[];
}

// cast to z.ZodType<Category>
export const DirTree: z.ZodType<DirTree> = z.lazy(() =>
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

interface LocationSunburst {
  name: string;
  hex?: string;
  children?: LocationSunburst[];
}

export const LocationSunburst: z.ZodType<LocationSunburst> = z.lazy(() =>
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
