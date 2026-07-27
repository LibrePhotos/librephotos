/**
 * App-side wiring for the sync orchestrator. Binds the pure job handlers to the
 * real api-client source, the user's favorite_min_rating, the expo device/upload
 * seams — and mirrors queue progress into the sync UI store. This module imports
 * the app singletons (apiClient, secure-store, expo-file-system), so it is NEVER
 * imported by the Node unit tests; those drive the orchestrator core directly
 * against a fake source.
 *
 * Each seam below is one *job's worth* of work, not one pipeline stage: a scan
 * chunk, a hash batch, a single upload. The queue decides what runs next.
 */
import { endpoints } from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import { apiClient, serverAddress } from "@/lib/apiClient";
import { tokenStorage } from "@/lib/tokenStorage";
import { useSettingsStore } from "@/stores/settings";
import { useSyncStore } from "@/stores/sync";
import { getBackupConfig } from "@/db/queries/backup";
import {
  repairSync,
  syncAll,
  syncBackupOnly,
  type SyncAllOptions,
  type SyncReason,
  type SyncResult,
} from "./orchestrator";
import { createApiSyncSource, type RemoteSyncSource } from "./remote/source";
import { replayOutbox } from "./outbox/executor";
import { prefetchNewThumbs } from "./thumb-prefetch";
import { syncDeviceMedia } from "./device/media-sync";
import { runHashPass } from "./device/hasher";
import { createExpoMediaProvider } from "./device/expo-media-provider";
import { createExpoAssetHasher } from "./device/expo-asset-hasher";
import type { MediaProvider, AssetHasher } from "./device/types";
import { enqueueBackups, queueSummary } from "./upload/queue";
import { runUploadItem } from "./upload/worker";
import { makeUploadGate } from "./upload/gate";
import { createExpoUploadTransport } from "./upload/expo-transport";
import { createExpoDeviceProbe } from "./upload/expo-probe";
import { jobQueueSnapshot } from "./jobs/status";
import type { UploadTransport } from "./upload/transport";
import type { DeviceProbe } from "./upload/gate";

let source: RemoteSyncSource | null = null;
function getSource(): RemoteSyncSource {
  return (source ??= createApiSyncSource(apiClient));
}

// Lazy app singletons for the device/upload seams (each pulls an expo native
// module, so they are created on first use, never at import time).
let mediaProvider: MediaProvider | null = null;
let assetHasher: AssetHasher | null = null;
let uploadTransport: UploadTransport | null = null;
let deviceProbe: DeviceProbe | null = null;
function getMediaProvider(): MediaProvider {
  return (mediaProvider ??= createExpoMediaProvider());
}
function getAssetHasher(): AssetHasher {
  return (assetHasher ??= createExpoAssetHasher());
}
function getUploadTransport(): UploadTransport {
  return (uploadTransport ??= createExpoUploadTransport({
    serverAddress,
    getAccessToken: async () => tokenStorage.getAccessToken(),
  }));
}
function getDeviceProbe(): DeviceProbe {
  return (deviceProbe ??= createExpoDeviceProbe());
}

/** Push the current queue snapshot to the UI store after every job settles. */
function publishQueue(db: AppDatabase): void {
  useSyncStore.getState().setQueue(jobQueueSnapshot(db));
}

/** Build the seams shared by every app-side run. */
function appSeams(userId: number | null | undefined): SyncAllOptions {
  return {
    onProgress: (p) => useSyncStore.getState().setProgress(p),
    getFavoriteMinRating:
      userId != null
        ? async () => {
            try {
              const user = await endpoints.fetchUserSelfDetails(apiClient, userId);
              return user.favorite_min_rating;
            } catch {
              return null; // network hiccup — skip the reseed check this run
            }
          }
        : undefined,

    replayOutbox: (ctx, budget) => replayOutbox(ctx.db, { signal: ctx.signal, log: ctx.log, maxRows: budget }),

    // One chunk of the camera roll. `maxAssetsPerRun` is what makes it a chunk:
    // the scan stores an ascending per-album watermark, so a truncated pass
    // resumes exactly where it stopped on the next job instead of re-walking the
    // library from the start (which is what used to make a reload fatal).
    scanChunk: async (ctx, budget) => {
      try {
        const result = await syncDeviceMedia(ctx.db, getMediaProvider(), {
          signal: ctx.signal,
          log: ctx.log,
          maxAssetsPerRun: budget,
          onProgress: (p) => useSyncStore.getState().setDeviceProgress(p),
        });
        return { complete: result.complete, added: result.added, scanned: result.scanned };
      } finally {
        useSyncStore.getState().setDeviceProgress(null);
      }
    },

    // One batch of md5s over new/changed images (videos are hashed lazily at
    // upload time). Enqueuing uploads is the job handler's business, not ours.
    hashBatch: async (ctx, budget) => {
      if (userId == null) return { hashed: 0, failed: 0, more: false };
      const result = await runHashPass(ctx.db, getAssetHasher(), {
        userId,
        signal: ctx.signal,
        log: ctx.log,
        maxAssets: budget,
        batchSize: budget,
      });
      // Materialise upload_queue rows for whatever just became hashable; the
      // handler then opens an upload window over them.
      if (getBackupConfig(ctx.db).enabled) enqueueBackups(ctx.db);
      return { hashed: result.hashed, failed: result.failed, more: result.more === true };
    },

    uploadAsset: async (ctx, assetId) => {
      if (userId == null) return { uploaded: false, skipped: true };
      const config = getBackupConfig(ctx.db);
      if (!config.enabled) return { uploaded: false, skipped: true };

      const gate = makeUploadGate(
        { wifiOnly: config.wifiOnly, chargingOnly: config.chargingOnly },
        getDeviceProbe()
      );
      // Publish the gate decision so the Backup screen can name the blocker
      // ("Waiting for Wi-Fi") instead of showing a stalled queue with no reason.
      const decision = await gate.check();
      useSyncStore.getState().setGate(decision);
      if (!decision.allowed) return { uploaded: false, skipped: false, gated: decision.reason };

      const result = await runUploadItem(ctx.db, assetId, {
        userId,
        transport: getUploadTransport(),
        signal: ctx.signal,
        log: ctx.log,
        onProgress: (id, sent, total) =>
          useSyncStore.getState().setProgress({
            entity: "photo",
            current: sent,
            total: Math.max(total, 1),
            phase: "delta",
          }),
      });
      return { uploaded: result.uploaded, skipped: result.skipped, gated: result.gated };
    },

    prefetchThumbs: async (ctx, limit) => {
      const token = await tokenStorage.getAccessToken();
      const fetched = await prefetchNewThumbs(ctx.db, {
        serverAddress: serverAddress(),
        accessToken: token,
        capBytes: useSettingsStore.getState().thumbCapBytes,
        limit,
        signal: ctx.signal,
      });
      return { fetched, more: fetched >= limit };
    },

    backupEnabled: (db) => getBackupConfig(db).enabled,
  };
}

/** Live upload-queue summary for the Backup screen header. */
export function backupQueueSummary(db: AppDatabase) {
  return queueSummary(db);
}

/**
 * Subscribe to camera-roll changes; a change nudges a foreground sync while the
 * app is open (doc 03 §4). Returns an unsubscribe handle. App-only.
 */
export function registerDeviceMediaListener(
  db: AppDatabase,
  getUserId: () => number | null
): () => void {
  const sub = getMediaProvider().addChangeListener(() => {
    void runSync(db, { userId: getUserId(), reason: "foreground" });
  });
  return () => sub.remove();
}

export type RunSyncOptions = {
  userId?: number | null;
  reason: SyncReason;
  signal?: AbortSignal;
  /**
   * Cap on jobs processed in this drain. The OS background window is short and
   * unpredictable, so the background task passes one: whatever prefix completes
   * is durable, and the rest stays queued for the next window.
   */
  maxJobs?: number;
};

/** Run a full sync (single-flight in the orchestrator), updating the UI store. */
export async function runSync(db: AppDatabase, opts: RunSyncOptions): Promise<SyncResult | null> {
  useSyncStore.getState().setRunning(true, opts.reason);
  try {
    const result = await syncAll(db, getSource(), {
      ...appSeams(opts.userId),
      reason: opts.reason,
      signal: opts.signal,
      maxJobs: opts.maxJobs,
      onWorkerProgress: () => publishQueue(db),
    });
    useSyncStore.getState().setResult(result);
    return result;
  } catch (err) {
    useSyncStore.getState().setError(err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    publishQueue(db);
    useSyncStore.getState().setRunning(false);
  }
}

/**
 * Backup-only run for the Backup tab: device scan → hash → upload, skipping the
 * heavy remote delta pull (that's what "Sync now" is for). Uploads that land
 * chain a photos delta so the merged-timeline badge flips. Returns the resulting
 * queue summary.
 */
export async function runBackupNow(
  db: AppDatabase,
  userId?: number | null,
  opts: { maxJobs?: number } = {}
) {
  useSyncStore.getState().setRunning(true, "manual");
  try {
    await syncBackupOnly(db, getSource(), {
      ...appSeams(userId),
      reason: "manual",
      maxJobs: opts.maxJobs,
      onWorkerProgress: () => publishQueue(db),
    });
  } catch (err) {
    useSyncStore.getState().setError(err instanceof Error ? err.message : String(err));
  } finally {
    publishQueue(db);
    useSyncStore.getState().setRunning(false);
  }
  return queueSummary(db);
}

/** Manual "Repair sync": wipe the mirror and reseed. */
export async function repair(db: AppDatabase, userId?: number | null): Promise<SyncResult | null> {
  useSyncStore.getState().setRunning(true, "manual");
  try {
    const result = await repairSync(db, getSource(), {
      ...appSeams(userId),
      onWorkerProgress: () => publishQueue(db),
    });
    useSyncStore.getState().setResult(result);
    return result;
  } catch (err) {
    useSyncStore.getState().setError(err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    publishQueue(db);
    useSyncStore.getState().setRunning(false);
  }
}
