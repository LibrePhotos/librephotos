/**
 * Background execution (doc 03 §7). Registers ONE OS background task
 * (expo-background-task + expo-task-manager) that runs a chunked top-up within
 * the OS time budget:
 *
 *   1. outbox replay  (push offline mutations)
 *   2. photos delta   (a useful prefix of the timeline)
 *   3. backup top-up  (device diff → hash → enqueue → upload, small budget)
 *   4. thumb top-up   (fill thumb_cache for new remote photos)
 *
 * Each step is independently useful, so any prefix that completes before the OS
 * suspends us still makes progress. The last-run result is written to `sync_log`
 * (visible on the Sync status screen). Honest constraints apply — both OSes
 * throttle to ~15-min minimums with no guarantees; this is a top-up, not the
 * primary path (foreground sync is).
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
import { apiClient, serverAddress } from "@/lib/apiClient";
import { tokenStorage } from "@/lib/tokenStorage";
import { userIdFromToken } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { appendSyncLog, type SyncLogEntry } from "@/db/queries/sync-log";
import { createApiSyncSource } from "../remote/source";
import { pullEntity } from "../remote/delta";
import { drainOutbox } from "../outbox/replay";
import { createApiOutboxExecutor } from "../outbox/executor";
import { prefetchNewThumbs } from "../thumb-prefetch";
import { runBackupNow } from "../run";

/** BGTaskScheduler identifier (iOS) / WorkManager unique name (Android). */
export const BACKGROUND_SYNC_TASK = "librephotos-background-sync";

/** Minimum cadence hint (minutes). The OS treats it as a floor, not a promise. */
const MIN_INTERVAL_MINUTES = 15;
/** Small per-window caps so any prefix is useful before the OS suspends us. */
const BG_OUTBOX_BUDGET = 25;
const BG_UPLOAD_BUDGET = 8;

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

  const now = Date.now();
  const log = (entry: SyncLogEntry) => appendSyncLog(db, entry, Date.now());
  const source = createApiSyncSource(apiClient);
  const started = Date.now();
  log({ op: "background", level: "info", message: "start" });

  let replayed = 0;
  try {
    // 1. Replay offline mutations first (replay-first ordering, doc 03 §1).
    const replay = await drainOutbox(db, createApiOutboxExecutor(), {
      now: () => now,
      log,
      maxRows: BG_OUTBOX_BUDGET,
    });
    replayed = replay.replayed;

    // 2. Photos delta — a useful prefix of the timeline even if we're suspended next.
    await pullEntity(db, source, "photo", { now, log });

    // 3. Backup top-up with a small budget for the short background window.
    if (userId != null) {
      await runBackupNow(db, userId, { uploadBudget: BG_UPLOAD_BUDGET });
    }

    // 4. Thumb cache top-up for the newly-pulled photos.
    await prefetchNewThumbs(db, {
      serverAddress: serverAddress(),
      accessToken: access,
      capBytes: useSettingsStore.getState().thumbCapBytes,
    });

    log({
      op: "background",
      level: "info",
      applied: replayed,
      durationMs: Date.now() - started,
      message: "done",
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
