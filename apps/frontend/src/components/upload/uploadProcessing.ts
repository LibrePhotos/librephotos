import type { ImportJob, UploadFailedFile, UploadStatus } from "@librephotos/api-client";
import type { UploadItem } from "./useUploadQueue";

/** The server reads at most this many job ids and photo ids in one status request. */
const MAX_FOLLOWED_IDS = 100;

/**
 * What the server said about the card's uploaded photos so far (#2739). An outcome, once known,
 * does not change back, so a photo is asked about only until it has one.
 */
export type ServerOutcomes = {
  /** Photos with their thumbnails: they show in the timeline. */
  ready: ReadonlySet<string>;
  /** Photos a step failed for, from their import job's `failed_files`. */
  failed: ReadonlyMap<string, UploadFailedFile>;
  /** Photos whose job finished while they were still not ready: they never will be. */
  lost: ReadonlySet<string>;
};

export const NO_OUTCOMES: ServerOutcomes = { ready: new Set(), failed: new Map(), lost: new Set() };

/** Where one uploaded file stands on the server. */
export type RowServerState =
  /** Not followed: not uploaded (yet), or a server before #2737 that names no import job. */
  | { kind: "untracked" }
  | { kind: "processing" }
  /** In the timeline; `problem` is a later step (tags, places, faces) that failed. */
  | { kind: "ready"; problem?: UploadFailedFile }
  /** The server could not make it a photo (it could not read the file), or lost its task. */
  | { kind: "failed"; failure?: UploadFailedFile };

/** An uploaded file the server imports, with the ids `/upload/complete/` answered. */
type TrackedItem = UploadItem & { jobId: string; photoId: string };

const isTracked = (item: UploadItem): item is TrackedItem =>
  item.status === "done" && item.jobId !== undefined && item.photoId !== undefined;

export function rowServerState(item: UploadItem, outcomes: ServerOutcomes): RowServerState {
  if (!isTracked(item)) return { kind: "untracked" };
  const failure = outcomes.failed.get(item.photoId);
  if (outcomes.ready.has(item.photoId)) return { kind: "ready", problem: failure };
  if (failure?.stage === "media" || outcomes.lost.has(item.photoId)) return { kind: "failed", failure };
  return { kind: "processing" };
}

/** The import jobs the card's files went into, the newest last. */
export function followedJobIds(items: UploadItem[]): string[] {
  const ids = new Set(items.flatMap(item => (item.jobId ? [item.jobId] : [])));
  return [...ids].slice(-MAX_FOLLOWED_IDS);
}

/** The uploads still processing that the next status request asks about, the oldest first. */
export function pendingUploads(items: UploadItem[], outcomes: ServerOutcomes): TrackedItem[] {
  return items
    .filter(isTracked)
    .filter(item => rowServerState(item, outcomes).kind === "processing")
    .slice(0, MAX_FOLLOWED_IDS);
}

/** The card's jobs in a status answer; a job deleted from the job list is left out. */
export const followedJobs = (status: UploadStatus, jobIds: readonly string[]): ImportJob[] =>
  status.imports.filter(job => jobIds.includes(job.job_id));

/**
 * Adds what a status answer says about the photos it was asked for (`asked`). A photo whose job
 * finished, or is gone, and that is still not ready is lost: the server read the job before the
 * photos, so it had every chance to be ready.
 */
export function absorbStatus(outcomes: ServerOutcomes, status: UploadStatus, asked: TrackedItem[]): ServerOutcomes {
  const ready = new Set([...outcomes.ready, ...status.ready_photo_ids]);
  const failed = new Map(outcomes.failed);
  status.imports.forEach(job =>
    job.result?.failed_files?.forEach(file => {
      if (file.photo_id) failed.set(file.photo_id, file);
    })
  );
  const unfinished = new Set(status.imports.filter(job => !job.finished).map(job => job.job_id));
  const lost = new Set(outcomes.lost);
  asked.filter(item => !ready.has(item.photoId) && !unfinished.has(item.jobId)).forEach(item => lost.add(item.photoId));
  const unchanged =
    ready.size === outcomes.ready.size && failed.size === outcomes.failed.size && lost.size === outcomes.lost.size;
  // Outcomes only grow: the same sizes mean nothing new, and the same object spares a render.
  return unchanged ? outcomes : { ready, failed, lost };
}

/**
 * The card's server phase: `untracked` when no upload named an import job, `processing` while a
 * job or photo is unfinished, `followups` while the search and face steps are still due, `done`.
 */
export type ProcessingPhase = "untracked" | "processing" | "followups" | "done";

export function processingPhase(
  items: UploadItem[],
  outcomes: ServerOutcomes,
  status: UploadStatus | undefined
): ProcessingPhase {
  const jobIds = followedJobIds(items);
  if (jobIds.length === 0) return "untracked";
  if (!status || pendingUploads(items, outcomes).length > 0) return "processing";
  const jobs = followedJobs(status, jobIds);
  if (jobs.some(job => !job.finished)) return "processing";
  const requested = jobs.every(job => job.result?.followups_requested === true);
  return requested && status.followups.state === "idle" ? "done" : "followups";
}

/** Uploads of `jobs` the server processed without an error, out of all it counted. */
export type ImportCounts = { ready: number; total: number };

export function importCounts(jobs: ImportJob[]): ImportCounts {
  return jobs.reduce(
    (acc, job) => {
      const target = job.progress_target ?? 0;
      // A task that ran after a lost job was finished can push the count past the target.
      const processed = Math.min(job.progress_current ?? 0, target);
      const failedCount = job.result?.error_count ?? job.result?.failed_files?.length ?? 0;
      return { ready: acc.ready + Math.max(processed - failedCount, 0), total: acc.total + target };
    },
    { ready: 0, total: 0 }
  );
}
