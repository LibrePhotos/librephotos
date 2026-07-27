/**
 * The job worker — the thing that replaced `runSequence`.
 *
 * Loop: claim the next eligible job atomically, run it, record the outcome,
 * enqueue whatever it chained, yield to the event loop, repeat. That is the
 * whole driver. There is no ordering baked into the code any more; ordering is
 * data (`priority`, `next_attempt_at`), which is what makes it impossible for a
 * slow step to starve the step behind it — the old chain's defining failure.
 *
 * Properties this module is responsible for:
 *
 *   - **atomic claim**   — delegated to `claimNextJob`; two loops never share a job.
 *   - **boot reclaim**   — a `running` row left by a killed process reverts to
 *                          `pending` on the first start of a process.
 *   - **cancellation**   — an AbortSignal stops the loop between jobs *and* is
 *                          handed to the handler, and the in-flight job is
 *                          released (not failed) so backgrounding costs nothing.
 *   - **yielding**       — a macrotask between jobs, so React can commit and the
 *                          timeline keeps painting during a 2867-photo scan.
 *
 * Pure: handlers are injected, so the whole thing runs under Node against
 * better-sqlite3 with fakes.
 */
import type { AppDatabase } from "@/db/types";
import type { SyncLogEntry } from "@/db/queries/sync-log";
import {
  claimNextJob,
  completeJob,
  enqueueJobs,
  failJob,
  hasEligibleJob,
  pruneJobs,
  reclaimStaleJobs,
  releaseJob,
} from "./queue";
import type { JobKind, JobRow, JobSpec } from "./types";

/** Bounded concurrency. One is deliberate: the device is a phone, and every
 *  handler already yields internally. Raising it is a one-line change, but the
 *  SQLite writes and the md5 pass are the bottleneck, not the loop. */
export const JOB_CONCURRENCY = 1;

/** Ceiling on jobs per drain, so a pathological chain cannot spin forever. */
const DEFAULT_MAX_JOBS = 10_000;

export class JobCancelledError extends Error {
  constructor() {
    super("job worker cancelled");
    this.name = "JobCancelledError";
  }
}

/** What a handler is given. */
export type JobContext = {
  db: AppDatabase;
  job: JobRow;
  signal?: AbortSignal;
  now: number;
  log: (entry: SyncLogEntry) => void;
};

/**
 * What a handler reports back. `enqueue` is applied *after* the job's own
 * outcome is recorded, which is what lets a job chain to itself: the
 * continuation's dedupe key is free again only once the current row has left the
 * live states.
 */
export type JobOutcome = {
  enqueue?: JobSpec[];
  applied?: number;
  deleted?: number;
  /** Short note for the sync log; omitted means "nothing worth saying". */
  note?: string;
} | void;

export type JobHandler = (ctx: JobContext) => Promise<JobOutcome>;

export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

export type WorkerOptions = {
  handlers: JobHandlers;
  signal?: AbortSignal;
  now?: () => number;
  log?: (entry: SyncLogEntry) => void;
  /** Yield hook between jobs (defaults to a macrotask yield). */
  yield?: () => Promise<void>;
  /** Safety valve on jobs processed in one drain. */
  maxJobs?: number;
  concurrency?: number;
  /** Called after every job settles — the UI's "something changed" nudge. */
  onProgress?: (stats: WorkerStats) => void;
};

export type WorkerStats = {
  processed: number;
  succeeded: number;
  failed: number;
  applied: number;
  deleted: number;
  /** Per-kind completion counts, for the run summary. */
  byKind: Partial<Record<JobKind, number>>;
  stoppedReason: "drained" | "cancelled" | "budget";
};

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Reclaim orphaned `running` rows once per process. Module-level, because
 * "another process was killed mid-job" is a fact about the process, not about
 * any one worker run — doing it on every drain would steal jobs from a
 * concurrent drain that legitimately owns them.
 */
let bootReclaimed = false;

export function runBootReclaim(db: AppDatabase, now = Date.now()): number {
  if (bootReclaimed) return 0;
  bootReclaimed = true;
  return reclaimStaleJobs(db, now, 0);
}

/** Test seam: forget that boot reclaim already ran. */
export function resetBootReclaimForTests(): void {
  bootReclaimed = false;
}

/**
 * Drain the queue until nothing is eligible, then return. "Eligible" excludes
 * jobs sitting out a backoff window, so a drain ends promptly instead of
 * busy-waiting on a retry that is minutes away; the next trigger picks them up.
 */
export async function runWorker(db: AppDatabase, opts: WorkerOptions): Promise<WorkerStats> {
  const now = opts.now ?? Date.now;
  const maxJobs = opts.maxJobs ?? DEFAULT_MAX_JOBS;
  const yieldFn = opts.yield ?? defaultYield;
  const concurrency = Math.max(1, opts.concurrency ?? JOB_CONCURRENCY);

  runBootReclaim(db, now());

  const stats: WorkerStats = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    applied: 0,
    deleted: 0,
    byKind: {},
    stoppedReason: "drained",
  };

  const lane = async (): Promise<void> => {
    for (;;) {
      if (opts.signal?.aborted) {
        stats.stoppedReason = "cancelled";
        return;
      }
      if (stats.processed >= maxJobs) {
        stats.stoppedReason = "budget";
        return;
      }
      const job = claimNextJob(db, now());
      if (!job) {
        // Nothing claimable. Another lane may still be producing work, but a
        // lane that finds the queue empty simply exits; the outer drain re-checks
        // once every lane has settled.
        return;
      }
      stats.processed += 1;
      await runOne(db, job, opts, stats, now);
      await yieldFn();
    }
  };

  // Outer loop so chained work enqueued by the last job in a pass is picked up
  // rather than left for the next trigger.
  for (;;) {
    await Promise.all(Array.from({ length: concurrency }, () => lane()));
    if (opts.signal?.aborted) {
      stats.stoppedReason = "cancelled";
      break;
    }
    if (stats.processed >= maxJobs) {
      stats.stoppedReason = "budget";
      break;
    }
    if (!hasEligibleJob(db, now())) break;
  }

  pruneJobs(db);
  return stats;
}

async function runOne(
  db: AppDatabase,
  job: JobRow,
  opts: WorkerOptions,
  stats: WorkerStats,
  now: () => number
): Promise<void> {
  const handler = opts.handlers[job.kind];
  const log = opts.log ?? (() => {});

  if (!handler) {
    // An unknown kind is a bug or a downgrade, not a transient fault: park it
    // terminally instead of retrying five times to reach the same conclusion.
    failJob(db, { id: job.id, attempts: Number.MAX_SAFE_INTEGER }, `no handler for ${job.kind}`, now());
    stats.failed += 1;
    log({ op: "job", entity: job.kind, level: "error", message: "no handler" });
    opts.onProgress?.(stats);
    return;
  }

  const started = Date.now();
  try {
    const outcome = await handler({ db, job, signal: opts.signal, now: now(), log });

    // A handler that returns after cancellation has not necessarily finished its
    // work, so treat the job as un-run rather than done.
    if (opts.signal?.aborted) {
      releaseJob(db, job.id);
      stats.stoppedReason = "cancelled";
      return;
    }

    completeJob(db, job.id, now());
    stats.succeeded += 1;
    stats.byKind[job.kind] = (stats.byKind[job.kind] ?? 0) + 1;
    if (outcome) {
      stats.applied += outcome.applied ?? 0;
      stats.deleted += outcome.deleted ?? 0;
      // Chained work is enqueued only after the outcome is recorded, so a job
      // that re-enqueues *itself* is not blocked by its own dedupe key.
      if (outcome.enqueue?.length) enqueueJobs(db, outcome.enqueue, now());
      if (outcome.note) {
        log({
          op: "job",
          entity: job.kind,
          level: "info",
          applied: outcome.applied,
          deleted: outcome.deleted,
          durationMs: Date.now() - started,
          message: outcome.note,
        });
      }
    }
  } catch (err) {
    if (opts.signal?.aborted) {
      // Cancellation is not the job's fault — hand it back with its attempt
      // refunded so backgrounding the app repeatedly cannot exhaust the budget.
      releaseJob(db, job.id);
      stats.stoppedReason = "cancelled";
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const outcome = failJob(db, job, message, now());
    stats.failed += 1;
    log({
      op: "job",
      entity: job.kind,
      level: outcome.state === "failed" ? "error" : "warn",
      durationMs: Date.now() - started,
      message:
        outcome.state === "failed"
          ? `failed permanently after ${job.attempts} attempts: ${message}`
          : `retry ${job.attempts}: ${message}`,
    });
  } finally {
    opts.onProgress?.(stats);
  }
}
