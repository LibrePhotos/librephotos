import { z } from "zod";
import { SimpleUser } from "./common";

export const Job = z.object({
  job_id: z.string(),
  queued_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  finished: z.boolean(),
  failed: z.boolean(),
  cancelled: z.boolean(),
  job_type: z.number(),
  job_type_str: z.string(),
  started_by: SimpleUser,
  error: z.any().optional(),
  progress_current: z.number().optional(),
  progress_target: z.number().optional(),
  progress_step: z.string().nullable().optional(),
  result: z.record(z.any()).nullable().optional(),
  id: z.number(),
});
export type Job = z.infer<typeof Job>;

export const JobsResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(Job),
});
export type JobsResponse = z.infer<typeof JobsResponse>;

export const JobDetail = z.object({
  id: z.number(),
  job_id: z.string(),
  queued_at: z.string(),
  finished: z.boolean(),
  finished_at: z.string().nullable(),
  started_at: z.string().nullable(),
  failed: z.boolean(),
  cancelled: z.boolean(),
  job_type_str: z.string(),
  job_type: z.number(),
  started_by: SimpleUser,
  progress_target: z.number(),
  progress_current: z.number(),
  progress_step: z.string().nullable().optional(),
  result: z.record(z.any()).nullable().optional(),
});
export type JobDetail = z.infer<typeof JobDetail>;

export const WorkerAvailabilityResponse = z.object({
  status: z.boolean(),
  queue_can_accept_job: z.boolean(),
  job_detail: JobDetail.nullish(),
  id: z.number().optional(),
});
export type WorkerAvailabilityResponse = z.infer<typeof WorkerAvailabilityResponse>;
