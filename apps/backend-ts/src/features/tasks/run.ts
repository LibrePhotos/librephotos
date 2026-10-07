// LongRunningJob bookkeeping shared by the task handlers (port of
// lp_tasks::run: Django's get_or_create_job, update_scan_counter and
// finish_job_if_complete from directory_watcher/utils.py, increments batched).
import { randomUUID } from "node:crypto";
import { client } from "../../lib/db";
import { JobErrors, type JobType } from "../../lib/jobs";

/** CANCELLATION_CHECK_INTERVAL: items between two cancellation polls. */
export const CANCEL_CHECK_EVERY = 100;

type Exec = typeof client;

async function createWithId(id: string, jobType: JobType, userId: number) {
  await client`INSERT INTO api_longrunningjob (job_type, finished, failed, cancelled, job_id, queued_at,
      started_at, started_by_id, progress_current, progress_target)
    VALUES (${jobType}, FALSE, FALSE, FALSE, ${id}, now(), now(), ${userId}, 0, 0)`;
}

/**
 * `LongRunningJob.get_or_create_job`: the row the enqueuer made (if any),
 * marked started; otherwise a new, started row. Returns its job_id.
 */
export async function begin(lrjId: string | null | undefined, jobType: JobType, userId: number): Promise<string> {
  let jobId: string;
  if (lrjId) {
    const [r] = await client`SELECT 1 AS x FROM api_longrunningjob WHERE job_id = ${lrjId}`;
    if (!r) await createWithId(lrjId, jobType, userId);
    jobId = lrjId;
  } else {
    jobId = randomUUID();
    await createWithId(jobId, jobType, userId);
  }
  await client`UPDATE api_longrunningjob SET started_at = now() WHERE job_id = ${jobId}`;
  return jobId;
}

/** `lrj.update_progress(current, target)`. */
export async function setProgress(jobId: string, current: number, target: number, tx: Exec = client) {
  await tx`UPDATE api_longrunningjob SET progress_current = ${current}, progress_target = ${Math.max(0, target)} WHERE job_id = ${jobId}`;
}

/** `lrj.complete()`: finished now, result untouched. */
export async function complete(jobId: string) {
  await client`UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() WHERE job_id = ${jobId}`;
}

/** `lrj.fail(error)`: {"status": "failed", "error": ...}. */
export async function fail(jobId: string, error: string) {
  await client`UPDATE api_longrunningjob SET failed = TRUE, finished = TRUE, finished_at = now(),
      result = ${JSON.stringify({ status: "failed", error })}::text::jsonb WHERE job_id = ${jobId}`;
}

export async function isCancelled(jobId: string): Promise<boolean> {
  const [r] = await client`SELECT cancelled FROM api_longrunningjob WHERE job_id = ${jobId}`;
  return r?.cancelled ?? false;
}

/**
 * `lrj.update_progress(0, target)`; with nothing to do the job completes at
 * once (`_begin_photo_scan`). Returns whether there is work.
 */
export async function startItems(jobId: string, target: number): Promise<boolean> {
  await setProgress(jobId, 0, Math.min(target, 2 ** 31 - 1));
  if (target === 0) {
    await complete(jobId);
    return false;
  }
  return true;
}

/**
 * `update_scan_counter` for a job whose items are processed here: counts
 * done items (flushed every 250 ms), keeps per-item errors in `result` and
 * finishes the job once the counter reaches the target, exactly once and
 * never after a cancel.
 */
export class ItemCounter {
  private pending = 0;
  private errors = new JobErrors();
  private errorsDirty = false;
  private last = Date.now();
  constructor(
    public readonly jobId: string,
    private target: number,
  ) {}

  get errorCount() {
    return this.errors.count;
  }

  async done(error?: string | null) {
    this.pending++;
    if (error) {
      this.errors.add(error);
      this.errorsDirty = true;
    }
    if (Date.now() - this.last >= 250) await this.flush();
  }

  async flush() {
    if (this.pending === 0 && !this.errorsDirty) {
      this.last = Date.now();
      return;
    }
    // Take the counts before awaiting: concurrent callers (forEachPhoto's
    // workers) must not flush the same increments twice.
    const pending = this.pending;
    const result = this.errorsDirty ? this.errors.toResult(this.target) : null;
    const failed = this.errors.isFailure(this.target);
    this.pending = 0;
    this.errorsDirty = false;
    this.last = Date.now();
    await client`UPDATE api_longrunningjob SET progress_current = progress_current + ${pending},
        result = COALESCE(${result === null ? null : JSON.stringify(result)}::text::jsonb, result),
        failed = failed OR ${failed}
      WHERE job_id = ${this.jobId} AND NOT cancelled`;
  }

  /** Flush, then `finish_job_if_complete`. Returns whether this call finished it. */
  async finish(): Promise<boolean> {
    await this.flush();
    return finishIfComplete(this.jobId);
  }
}

/** `finish_job_if_complete`: the guarded transition, once. */
export async function finishIfComplete(jobId: string): Promise<boolean> {
  const r = await client`UPDATE api_longrunningjob SET finished = TRUE, finished_at = now()
    WHERE job_id = ${jobId} AND NOT finished AND NOT cancelled AND progress_current >= progress_target RETURNING 1`;
  return r.length > 0;
}

/**
 * `_limit_to_photos_added_since_last_scan`'s baseline: started_at of the
 * user's most recently finished job of this type (Postgres sorts a NULL
 * finished_at first, as Django's order_by("-finished_at") does).
 * undefined = no such job; null = one exists but never started, which
 * Django turns into `added_on > NULL` (nothing).
 */
export async function lastFinishedStart(userId: number, jobType: JobType, excludeZeroTarget: boolean): Promise<string | null | undefined> {
  // As text: a JS Date would drop the microseconds the comparison needs.
  const r = excludeZeroTarget
    ? await client`SELECT started_at::text AS started_at FROM api_longrunningjob WHERE finished AND job_type = ${jobType} AND started_by_id = ${userId}
        AND progress_target <> 0 ORDER BY finished_at DESC LIMIT 1`
    : await client`SELECT started_at::text AS started_at FROM api_longrunningjob WHERE finished AND job_type = ${jobType} AND started_by_id = ${userId}
        ORDER BY finished_at DESC LIMIT 1`;
  if (!r.length) return undefined;
  return r[0].started_at ?? null;
}

/** The SQL filter for an optional "added since" baseline: [use, ts text]. */
export const sinceParams = (since: string | null | undefined): [boolean, string | null] => [since !== undefined, since ?? null];
