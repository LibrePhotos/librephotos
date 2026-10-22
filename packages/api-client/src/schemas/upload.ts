import { z } from "zod";
import { Job } from "./jobs";

/**
 * Chunked upload request. `form_data` is a FormData carrying the chunk bytes;
 * the transport passes FormData through untouched (no JSON encoding).
 */
export const UploadOptions = z.object({
  form_data: z.instanceof(FormData),
  offset: z.number(),
  chunk_size: z.number(),
});
export type UploadOptions = z.infer<typeof UploadOptions>;

/**
 * `POST /upload/` chunk response (chunked_upload/views.py get_response_data): the upload to send
 * the next chunk to, and the bytes it holds so far.
 */
export const UploadResponse = z.object({
  upload_id: z.string(),
  offset: z.number(),
});
export type UploadResponse = z.infer<typeof UploadResponse>;

/**
 * `POST /upload/complete/`: the import job counting the upload and the photo it made (#2737; both
 * null for a file that made no photo, such as a sidecar), or, for a file the user already had,
 * `detail` and that photo's id. Servers before #2737 answer `{}`, so every field is optional.
 */
export const UploadCompleteResponse = z.looseObject({
  job_id: z.string().nullable().optional(),
  photo_id: z.string().nullable().optional(),
  detail: z.string().optional(),
});
export type UploadCompleteResponse = z.infer<typeof UploadCompleteResponse>;

/**
 * `GET /exists/{md5}{user id}/`: whether the user already has a photo with this hash, and its id
 * (to file it into an album, #612; servers before it send no id).
 */
export const UploadExistsResponse = z.object({
  exists: z.boolean(),
  photo_id: z.string().nullable().optional(),
});
export type UploadExistsResponse = z.infer<typeof UploadExistsResponse>;

/** `POST /upload/seal/`: the import jobs the call sealed (another user's or a finished one is left out). */
export const UploadSealResponse = z.object({
  sealed_job_ids: z.array(z.string()),
});
export type UploadSealResponse = z.infer<typeof UploadSealResponse>;

/**
 * One photo an upload import could not process (`result.failed_files` of an Import Uploads job):
 * `photo_id` is what `/upload/complete/` answered, `stage` the first step that failed (`media` means
 * the server could not read the file, so it never shows).
 */
export const UploadFailedFile = z.looseObject({
  photo_id: z.string().nullable(),
  file: z.string(),
  stage: z.string().nullable(),
  error: z.string().nullable(),
});
export type UploadFailedFile = z.infer<typeof UploadFailedFile>;

/** What an Import Uploads job (type 20) keeps in its `result`, besides what every job has. */
export const ImportJobResult = z.looseObject({
  // The newest 100 failures; error_count counts them all (lost uploads too).
  failed_files: z.array(UploadFailedFile).optional(),
  error_count: z.number().optional(),
  // Uploads never processed: the sweeper finished the job as lost.
  lost: z.number().optional(),
  // The job finished and asked for the follow-ups (search embeddings, faces).
  followups_requested: z.boolean().optional(),
});
export type ImportJobResult = z.infer<typeof ImportJobResult>;

/** An Import Uploads job, with its `result` read (without `error`, which no current server sends). */
export const ImportJob = Job.omit({ error: true }).extend({
  result: ImportJobResult.nullable().optional(),
});
export type ImportJob = z.infer<typeof ImportJob>;

/** The library-level work after uploads: `pending` while a run starts within minutes. */
export const UploadFollowups = z.object({
  state: z.enum(["idle", "pending", "running"]),
  next_run_at: z.string().nullable(),
});
export type UploadFollowups = z.infer<typeof UploadFollowups>;

/**
 * `GET /upload/status/` (#2739): the caller's unfinished upload imports (the phone's too) and the
 * named ones, which of the named photos are ready (they have thumbnails), and the follow-ups.
 */
export const UploadStatus = z.object({
  imports: z.array(ImportJob),
  ready_photo_ids: z.array(z.string()),
  followups: UploadFollowups,
});
export type UploadStatus = z.infer<typeof UploadStatus>;

/** What an upload client follows in `GET /upload/status/`: at most 100 of each. */
export type UploadStatusParams = {
  jobIds?: readonly string[];
  photoIds?: readonly string[];
};
