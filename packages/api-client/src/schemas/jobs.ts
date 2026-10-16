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
  // The starter's scan baseline, which the server refuses to remove (409 scan_baseline, #1104).
  // Older servers do not send it.
  is_scan_baseline: z.boolean().optional(),
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
  // See Job.is_scan_baseline.
  is_scan_baseline: z.boolean().optional(),
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

/** `POST /generate-captions/`: the started job, and whether the captioning model is downloaded first (#2211). */
export const CaptionsJobStartedResponse = JobStartedResponse.extend({
  downloads_model: z.boolean(),
});
export type CaptionsJobStartedResponse = z.infer<typeof CaptionsJobStartedResponse>;

/** `POST /savemetadata/` (202): the queued "Write metadata to files" job and what it writes (#2287). */
export const WriteMetadataStarted = z.looseObject({
  job_id: z.string(),
  types: z.string().array(),
});
export type WriteMetadataStarted = z.infer<typeof WriteMetadataStarted>;

/** Where "Write metadata to files" writes: the saved "Write edits to files"; null while that is Off. */
export const WriteMetadataTarget = z.enum(["sidecar", "media_file"]);
export type WriteMetadataTarget = z.infer<typeof WriteMetadataTarget>;

/** One type of "Write metadata to files" and how many photos have a value of it. */
export const WriteTypeCount = z.object({
  type: z.string(),
  photos: z.number().int(),
});
export type WriteTypeCount = z.infer<typeof WriteTypeCount>;

/** `GET /savemetadata/`: what "Write metadata to files" would write for the signed-in user now. */
export const WriteMetadataPreview = z.object({
  target: WriteMetadataTarget.nullable(),
  counts: WriteTypeCount.array(),
  total: z.number().int(),
});
export type WriteMetadataPreview = z.infer<typeof WriteMetadataPreview>;

/**
 * `POST /photos/rescan/`: the scan that reads the chosen photos' files again (#2214), with how many
 * photos it covers and their files (main files, variants and sidecars).
 */
export const RescanPhotosResponse = JobStartedResponse.extend({
  photo_count: z.number(),
  file_count: z.number(),
});
export type RescanPhotosResponse = z.infer<typeof RescanPhotosResponse>;

/** `POST /scan-files/`: the scan of the files an outside process named (#900), and the paths it left out. */
export const ScanFilesResponse = JobStartedResponse.extend({
  file_count: z.number(),
  ignored_paths: z.array(z.string()),
});
export type ScanFilesResponse = z.infer<typeof ScanFilesResponse>;

/** What a job trigger answers when a job of its kind is already queued or running (a 409). */
export type JobAlreadyRunning = { status: true; job_id: string; already_running: true };

/**
 * One row of the Admin page's Finish the upgrade card (`GET /upgrade-tasks/`, #2322): work an
 * upgrade left for this instance. `automatic` tasks run by themselves and are required;
 * `optional` ones (kind `action`) wait for Start and may be dismissed. Progress is that of the
 * running jobs.
 */
export const UpgradeTask = z.object({
  key: z.string(),
  kind: z.enum(["automatic", "action"]),
  optional: z.boolean(),
  status: z.enum(["pending", "running", "failed", "done"]),
  count: z.number().nullable(),
  progress_current: z.number().nullable(),
  progress_target: z.number().nullable(),
  // The job list's id (Job.id) of the running job, else the last one.
  latest_job_id: z.number().nullable(),
  error: z.string().nullable(),
  completed_at: z.string().nullable(),
});
export type UpgradeTask = z.infer<typeof UpgradeTask>;

/** `GET /upgrade-tasks/`, and the answer of a dismiss: the tasks still left, and those done today. */
export const UpgradeTaskList = z.object({
  tasks: z.array(UpgradeTask),
});
export type UpgradeTaskList = z.infer<typeof UpgradeTaskList>;

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
