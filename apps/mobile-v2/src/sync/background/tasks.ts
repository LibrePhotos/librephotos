/**
 * Background execution (doc 03 §7). Registers ONE OS background task
 * (expo-background-task + expo-task-manager) that drains a bounded slice of the
 * job queue within the OS time budget.
 *
 * This used to be a hand-rolled copy of the foreground sequence — replay,
 * photos delta, backup top-up, thumbs — which meant two places to keep in step
 * and no record of how far a suspended pass had got. It now enqueues the same
 * jobs the foreground does and runs the worker with a job budget: priorities
 * already put the outbox and the photo delta first, so the useful prefix is the
 * default rather than something the step order has to encode, and every
 * completed job is durable when the OS suspends us mid-window.
 *
 * Honest constraints still apply — both OSes throttle to ~15-min minimums with
 * no guarantees; this is a top-up, not the primary path (foreground sync is).
 *
 * App-only: pulls expo + the api-client singleton, so it is never imported by
 * the Node test project. The registration is idempotent and safe to call at
 * every app start.
 */
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import type { AppDatabase } from "@/db/types";
import { openDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { tokenStorage } from "@/lib/tokenStorage";
import { userIdFromToken } from "@/stores/auth";
import { appendSyncLog, type SyncLogEntry } from "@/db/queries/sync-log";
import { runSync } from "../run";

/** BGTaskScheduler identifier (iOS) / WorkManager unique name (Android). */
export const BACKGROUND_SYNC_TASK = "librephotos-background-sync";

/** Minimum cadence hint (minutes). The OS treats it as a floor, not a promise. */
const MIN_INTERVAL_MINUTES = 15;
/**
 * Jobs per background window. Every job is sized to finish well under a second,
 * so this is roughly a 30-second slice — comfortably inside both platforms'
 * budgets, and whatever completes is persisted.
 */
const BG_JOB_BUDGET = 30;

/** Register the task executor once at module load (defineTask must run eagerly). */
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    await runBackgroundPass();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Register the background task with the OS. Idempotent — re-registering with the
 * same identifier just updates the options. No-op when the OS reports the API is
 * restricted (e.g. Low Power Mode / user disabled background refresh).
 */
export async function registerBackgroundTasks(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: MIN_INTERVAL_MINUTES,
    });
  } catch {
    // Unavailable on this platform/build (e.g. web) — silently skip.
  }
}

export async function unregisterBackgroundTasks(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    }
  } catch {
    // ignore
  }
}

/**
 * The chunked background pass. Exported for a manual "run once" trigger and for
 * the eager `defineTask` executor above. Opens the DB itself (headless — no
 * React), and bails early when signed out.
 */
export async function runBackgroundPass(): Promise<void> {
  const refresh = await tokenStorage.getRefreshToken();
  if (!refresh) return; // signed out — nothing to do

  const access = await tokenStorage.getAccessToken();
  const userId = userIdFromToken(access);

  const { db, sqlite } = openDb();
  await runMigrations(db, sqlite);

  const log = (entry: SyncLogEntry) => appendSyncLog(db, entry, Date.now());
  const started = Date.now();
  log({ op: "background", level: "info", message: "start" });

  try {
    // One bounded drain. The queue's priorities do what the old hand-written
    // step order did — outbox and the photo delta first, backup and thumbs
    // behind them — except that anything left over stays queued instead of
    // being forgotten when the OS suspends us.
    const result = await runSync(db, {
      userId,
      reason: "foreground",
      maxJobs: BG_JOB_BUDGET,
    });

    log({
      op: "background",
      level: "info",
      applied: result?.applied ?? 0,
      durationMs: Date.now() - started,
      message: result
        ? `done — ${result.jobs.processed} job(s), ${result.jobs.stoppedReason}`
        : "done",
    });
  } catch (err) {
    log({
      op: "background",
      level: "warn",
      durationMs: Date.now() - started,
      message: `interrupted: ${err instanceof Error ? err.message : String(err)}`,
    });
    throw err;
  }
}

/** Manual trigger (Sync status screen) — runs the same pass in the foreground. */
export function runBackgroundPassNow(_db?: AppDatabase): Promise<void> {
  return runBackgroundPass();
}
