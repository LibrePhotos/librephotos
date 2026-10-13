import { z } from "zod";
import { PageFields, SimpleUser } from "./common";

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
  // Not sent by current servers (LongRunningJobSerializer has no such field).
  error: z.unknown().optional(),
  progress_current: z.number().optional(),
  progress_target: z.number().optional(),
  progress_step: z.string().nullable().optional(),
  // Whatever the job reported: status, error, error_count, errors, counts...
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  id: z.number(),
});
export type Job = z.infer<typeof Job>;

export const JobsResponse = z.object({
  ...PageFields,
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
  // Whatever the job reported: status, error, error_count, errors, counts...
  result: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type JobDetail = z.infer<typeof JobDetail>;

export const WorkerAvailabilityResponse = z.object({
  status: z.boolean(),
  queue_can_accept_job: z.boolean(),
  job_detail: JobDetail.nullish(),
});
export type WorkerAvailabilityResponse = z.infer<typeof WorkerAvailabilityResponse>;

/** `POST /jobs/{id}/cancel/`: the job, now cancelled. */
export const CancelJobResponse = z.object({
  status: z.boolean(),
  job: JobDetail.optional(),
});
export type CancelJobResponse = z.infer<typeof CancelJobResponse>;

/** The job list's query (`GET /jobs/`). */
export type JobListParams = {
  page?: number;
  pageSize?: number;
  /**
   * Narrow the list to the caller's own jobs. Only meaningful for staff, who otherwise get the
   * global list; everyone else is already scoped server-side.
   */
  mine?: boolean;
};

/** What a view that starts a job answers (`api.jobs.start.start_jobs`): the job's id, and every step's. */
export const JobStartedResponse = z.looseObject({
  status: z.boolean(),
  job_id: z.string(),
  job_ids: z.array(z.string()).optional(),
});
export type JobStartedResponse = z.infer<typeof JobStartedResponse>;

/** What a job trigger answers when a job of its kind is already queued or running (a 409). */
export type JobAlreadyRunning = { status: true; job_id: string; already_running: true };

/** `POST /photos/download`: the archive job and the archive's file name (a UUID). */
export const PhotoDownloadStart = z.looseObject({
  job_id: z.string(),
  url: z.string(),
});
export type PhotoDownloadStart = z.infer<typeof PhotoDownloadStart>;

/** `GET /photos/download?job_id=`: PENDING (a 202), SUCCESS, or FAILURE for a failed or cancelled job. */
export const PhotoDownloadStatus = z.looseObject({
  status: z.string(),
});
export type PhotoDownloadStatus = z.infer<typeof PhotoDownloadStatus>;
