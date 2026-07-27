/**
 * Sync orchestrator (doc 03 §1).
 *
 * `syncAll()` used to *be* the pipeline: a strict `await` chain of outbox replay
 * → remote delta → device scan → hashing → uploads → thumbs. On a real
 * 2867-photo library that shape failed three ways at once — hashing stalled
 * behind a full camera-roll enumeration, uploads never started because they sat
 * last behind the slowest steps, and the only record of progress was the call
 * stack, so a JS reload restarted everything from the top. A user watched 161
 * photos hash, reloaded, and the counter never moved again.
 *
 * So `syncAll()` no longer *runs* anything. It:
 *
 *   1. enqueues the jobs a full sync consists of (see `jobs/handlers.fullSyncJobs`),
 *   2. ensures the worker is running,
 *   3. resolves when the queue drains.
 *
 * Ordering, resumption and fairness are now properties of the `job_queue` table
 * and the worker's priority/round-robin rules, not of this file's control flow.
 * Progress is durable: kill the app mid-run and the surviving rows say exactly
 * what is left to do.
 *
 * The public surface is unchanged for callers — `syncAll`, `repairSync`,
 * `cancelSync`, `isSyncing`, `needsInitialSeed` all keep their signatures. The
 * *steps* moved from injected `SyncHooks` to injected {@link JobSeams}, which is
 * the same idea one layer down: the core stays pure and Node-testable against a
 * fake source, and the app wiring lives in ./run.
 */
import type { AppDatabase } from "@/db/types";
import { clearMirror } from "@/db/reset";
import { getSyncState, SYNC_ENTITIES } from "@/db/queries/sync-state";
import { appendSyncLog, type SyncLogEntry } from "@/db/queries/sync-log";
import type { RemoteSyncSource } from "./remote/source";
import { SyncAbortedError, type PullOptions, type SyncProgress } from "./remote/delta";
import type { IntegrityReport } from "./integrity";
import { enqueueJobs, clearJobs } from "./jobs/queue";
import { runWorker, type WorkerStats } from "./jobs/worker";
import {
  backupJobs,
  createJobHandlers,
  fullSyncJobs,
  type JobSeams,
  type OutboxReplayResult,
} from "./jobs/handlers";

export type SyncReason = "login" | "foreground" | "refresh" | "connectivity" | "outbox" | "manual";

export type { OutboxReplayResult };

/** Everything the app injects into a run. `source` is passed separately. */
export type SyncAllOptions = PullOptions &
  Omit<JobSeams, "source" | "pull" | "onIntegrity" | "onOutbox" | "onReseed"> & {
    reason?: SyncReason;
    /** Skip the favorite_min_rating check + integrity (used by repairSync). */
    skipIntegrity?: boolean;
    /** Called after every job settles, so the UI can refresh queue counters. */
    onWorkerProgress?: (stats: WorkerStats) => void;
    /** Yield hook between jobs (tests use a synchronous one). */
    yield?: () => Promise<void>;
    /** Safety valve on jobs processed in one drain. */
    maxJobs?: number;
  };

export type SyncResult = {
  reason: SyncReason;
  applied: number;
  deleted: number;
  reseeded: boolean;
  integrity: IntegrityReport | null;
  outbox: OutboxReplayResult | null;
  durationMs: number;
  /** Per-run queue statistics — jobs processed, succeeded, failed. */
  jobs: WorkerStats;
};

/** Whether a first full seed is still needed (photo mirror never completed). */
export function needsInitialSeed(db: AppDatabase): boolean {
  return getSyncState(db, "photo")?.status !== "done";
}

let inFlight: Promise<SyncResult> | null = null;
let controller: AbortController | null = null;
let lastRunAt = 0;

/** Timestamp (ms) of the last completed or attempted syncAll. */
export function lastSyncRunAt(): number {
  return lastRunAt;
}

/** True while a syncAll is in progress. */
export function isSyncing(): boolean {
  return inFlight != null;
}

/**
 * Cancel the in-flight run. Safe to call when idle, and safe to call on app
 * background: the worker stops between jobs and hands its claimed job back to
 * `pending` with the attempt refunded, so nothing is lost and nothing is
 * punished for being interrupted.
 */
export function cancelSync(): void {
  controller?.abort();
}

/**
 * Enqueue a full sync and drain the queue. Single-flight: concurrent callers
 * share the one in-flight drain (the jobs themselves are deduped by key, so an
 * overlapping trigger adds nothing anyway). The caller's `signal` is linked to
 * the shared controller.
 */
export function syncAll(
  db: AppDatabase,
  source: RemoteSyncSource,
  opts: SyncAllOptions = {}
): Promise<SyncResult> {
  return startRun(db, source, opts, () => fullSyncJobs({ skipIntegrity: opts.skipIntegrity }));
}

/**
 * Backup-only run for the Backup tab: device scan → hash → upload, skipping the
 * remote delta pull (that is what "Sync now" is for). Uploads that land still
 * chain a photos delta, so the merged-timeline badge flips.
 */
export function syncBackupOnly(
  db: AppDatabase,
  source: RemoteSyncSource,
  opts: SyncAllOptions = {}
): Promise<SyncResult> {
  return startRun(db, source, { ...opts, skipIntegrity: true }, backupJobs);
}

function startRun(
  db: AppDatabase,
  source: RemoteSyncSource,
  opts: SyncAllOptions,
  jobs: () => ReturnType<typeof fullSyncJobs>
): Promise<SyncResult> {
  if (inFlight) return inFlight;
  controller = new AbortController();
  const signal = controller.signal;
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller?.abort(), { once: true });
  }

  inFlight = drain(db, source, { ...opts, signal }, jobs).finally(() => {
    inFlight = null;
    controller = null;
    lastRunAt = Date.now();
  });
  return inFlight;
}

async function drain(
  db: AppDatabase,
  source: RemoteSyncSource,
  opts: SyncAllOptions,
  jobs: () => ReturnType<typeof fullSyncJobs>
): Promise<SyncResult> {
  const now = opts.now ?? Date.now();
  const reason = opts.reason ?? "foreground";
  const wallStart = Date.now();
  const log = (entry: SyncLogEntry) => appendSyncLog(db, entry, Date.now());

  log({ op: "run", level: "info", message: `start:${reason}` });

  // Results the handlers report back out of band — they belong to the *run*,
  // not to any single job. Held in one object rather than three `let`s so
  // TypeScript does not narrow them to their initial values across the await.
  const out: {
    integrity: IntegrityReport | null;
    outbox: OutboxReplayResult | null;
    reseeded: boolean;
  } = { integrity: null, outbox: null, reseeded: false };

  const seams: JobSeams = {
    source,
    getFavoriteMinRating: opts.skipIntegrity ? undefined : opts.getFavoriteMinRating,
    replayOutbox: opts.replayOutbox,
    scanChunk: opts.scanChunk,
    hashBatch: opts.hashBatch,
    uploadAsset: opts.uploadAsset,
    prefetchThumbs: opts.prefetchThumbs,
    backupEnabled: opts.backupEnabled,
    budgets: opts.budgets,
    skipIntegrity: opts.skipIntegrity,
    pull: { pageSize: opts.pageSize, onProgress: opts.onProgress },
    onIntegrity: (r) => {
      out.integrity = r;
    },
    onOutbox: (r) => {
      out.outbox = r;
    },
    onReseed: () => {
      out.reseeded = true;
    },
  };

  enqueueJobs(db, jobs(), now);

  const stats = await runWorker(db, {
    handlers: createJobHandlers(seams),
    signal: opts.signal,
    log,
    yield: opts.yield,
    maxJobs: opts.maxJobs,
    onProgress: opts.onWorkerProgress,
  });

  // A cancelled drain is not a completed sync. Throwing keeps the contract the
  // old sequence had (callers treat an abort as an error), and the queue rows
  // survive so the next run picks up exactly where this one stopped.
  if (stats.stoppedReason === "cancelled") throw new SyncAbortedError();

  const result: SyncResult = {
    reason,
    applied: stats.applied,
    deleted: stats.deleted,
    reseeded: out.reseeded,
    integrity: out.integrity,
    outbox: out.outbox,
    durationMs: Date.now() - wallStart,
    jobs: stats,
  };
  log({
    op: "run",
    level: stats.failed > 0 ? "warn" : "info",
    applied: stats.applied,
    deleted: stats.deleted,
    durationMs: result.durationMs,
    // `slowest` is the responsiveness number: however long the whole drain took,
    // what the user actually feels is the longest single job in it.
    message:
      `done:${reason} — ${stats.processed} job(s), ${stats.failed} failed, ` +
      `slowest job ${stats.slowest}ms`,
  });
  return result;
}

/**
 * Manual "Repair sync": wipe the whole mirror and re-seed from zero. Also clears
 * the job queue, because a repair invalidates every cursor those jobs were
 * resuming from — leaving them would have the new seed race a stale continuation.
 */
export async function repairSync(
  db: AppDatabase,
  source: RemoteSyncSource,
  opts: SyncAllOptions = {}
): Promise<SyncResult> {
  clearMirror(db);
  clearJobs(db);
  appendSyncLog(db, { op: "reseed", level: "warn", message: "manual repair" }, Date.now());
  return syncAll(db, source, { ...opts, reason: "manual" });
}

export { SyncAbortedError, SYNC_ENTITIES };
export type { SyncProgress, JobSeams, WorkerStats };
