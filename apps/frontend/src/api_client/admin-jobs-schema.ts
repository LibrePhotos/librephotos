import { z } from "zod";

import { SimpleUser } from "./user/types";

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
  progress_current: z.number().optional(),
  progress_target: z.number().optional(),
  id: z.number(),
});

export type Job = z.infer<typeof Job>;

export const JobRequest = z.object({
  pageSize: z.number().optional(),
  page: z.number().optional(),
});

export type JobRequest = z.infer<typeof JobRequest>;

export const JobsResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(Job),
});

export type JobsResponse = z.infer<typeof JobsResponse>; 