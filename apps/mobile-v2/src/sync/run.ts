/**
 * App-side wiring for the sync orchestrator. Binds the pure orchestrator to the
 * real api-client source, the user's favorite_min_rating, the thumb-prefetch
 * step, and the outbox-replay stub — and mirrors progress/result into the sync
 * UI store. This module imports the app singletons (apiClient, secure-store,
 * expo-file-system), so it is NEVER imported by the Node unit tests; those test
 * the orchestrator core directly against a fake source.
 */
import { endpoints } from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import { apiClient, serverAddress } from "@/lib/apiClient";
import { tokenStorage } from "@/lib/tokenStorage";
import { useSettingsStore } from "@/stores/settings";
import { useSyncStore } from "@/stores/sync";
import { getBackupConfig } from "@/db/queries/backup";
import { appendSyncLog } from "@/db/queries/sync-log";
import {
  repairSync,
  syncAll,
  type SyncAllOptions,
  type SyncReason,
  type SyncResult,
} from "./orchestrator";
import { createApiSyncSource, type RemoteSyncSource } from "./remote/source";
import { pullEntity } from "./remote/delta";
import { replayOutbox } from "./outbox/executor";
import { prefetchNewThumbs } from "./thumb-prefetch";
import { syncDeviceMedia } from "./device/media-sync";
import { runHashPass } from "./device/hasher";
import { createExpoMediaProvider } from "./device/expo-media-provider";
import { createExpoAssetHasher } from "./device/expo-asset-hasher";
import type { MediaProvider, AssetHasher } from "./device/types";
import { enqueueBackups, queueSummary } from "./upload/queue";
import { runUploadQueue } from "./upload/worker";
import { makeUploadGate } from "./upload/gate";
import { createExpoUploadTransport } from "./upload/expo-transport";
import { createExpoDeviceProbe } from "./upload/expo-probe";
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

/** Per-run cap on how many uploads the foreground top-up runs. */
const UPLOAD_BUDGET = 50;

/** Build the injected hooks shared by every app-side run. */
function appHooks(
  userId: number | null | undefined,
  runOpts: { uploadBudget?: number } = {}
): SyncAllOptions {
  const uploadBudget = runOpts.uploadBudget ?? UPLOAD_BUDGET;
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
    replayOutbox,
    // Step 3 — camera-roll diff into the local_asset tables. Progress goes to
    // the UI store: on a large library this is the long pole right after the
    // permission prompt, and a silent screen there reads as a freeze.
    syncDeviceMedia: async ({ db, signal, log }) => {
      try {
        await syncDeviceMedia(db, getMediaProvider(), {
          signal,
          log,
          onProgress: (p) => useSyncStore.getState().setDeviceProgress(p),
        });
      } finally {
        useSyncStore.getState().setDeviceProgress(null);
      }
    },
    // Step 4 — hash new/changed images (videos are lazy-hashed at upload time).
    // Enqueue after every batch so uploads start on the first hashed photos
    // instead of waiting out an md5 pass over the whole library.
    hashAssets: async ({ db, signal, log }) => {
      if (userId == null) return;
      await runHashPass(db, getAssetHasher(), {
        userId,
        signal,
        log,
        onBatch: () => {
          if (getBackupConfig(db).enabled) enqueueBackups(db);
        },
      });
    },
    // Step 5 — top up + drain the upload queue when backup is enabled.
    topUpUploadQueue: async ({ db, source: src, signal, log }) => {
      if (userId == null) return;
      const config = getBackupConfig(db);
      if (!config.enabled) return;

      // Lazily hash selected videos so they become upload-eligible, enqueueing
      // as we go (a GB-scale video pass must not withhold everything already
      // hashed from the queue).
      await runHashPass(db, getAssetHasher(), {
        userId,
        signal,
        includeVideos: true,
        selectedOnly: true,
        log,
        onBatch: () => enqueueBackups(db),
      });
      enqueueBackups(db);

      const gate = makeUploadGate(
        { wifiOnly: config.wifiOnly, chargingOnly: config.chargingOnly },
        getDeviceProbe()
      );
      // Publish the gate decision so the Backup screen can name the blocker
      // ("Waiting for Wi-Fi") instead of showing a stalled queue with no reason.
      useSyncStore.getState().setGate(await gate.check());
      const result = await runUploadQueue(db, {
        userId,
        transport: getUploadTransport(),
        gate,
        signal,
        maxItems: uploadBudget,
        log,
        onProgress: (assetId, sent, total) =>
          useSyncStore.getState().setProgress({
            entity: "photo",
            current: sent,
            total: Math.max(total, 1),
            phase: "delta",
          }),
      });
      // A successful upload means new server rows: pull a photos delta so the
      // merged-timeline badge flips from pending to synced (doc 03 §5).
      if (result.uploaded > 0) {
        await pullEntity(db, src, "photo", { signal, log });
      }
    },
    prefetchThumbs: async ({ db, signal }) => {
      const token = await tokenStorage.getAccessToken();
      await prefetchNewThumbs(db, {
        serverAddress: serverAddress(),
        accessToken: token,
        capBytes: useSettingsStore.getState().thumbCapBytes,
        signal,
      });
    },
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
};

/** Run a full sync (single-flight in the orchestrator), updating the UI store. */
export async function runSync(db: AppDatabase, opts: RunSyncOptions): Promise<SyncResult | null> {
  useSyncStore.getState().setRunning(true, opts.reason);
  try {
    const result = await syncAll(db, getSource(), {
      ...appHooks(opts.userId),
      reason: opts.reason,
      signal: opts.signal,
    });
    useSyncStore.getState().setResult(result);
    return result;
  } catch (err) {
    useSyncStore.getState().setError(err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    useSyncStore.getState().setRunning(false);
  }
}

let backupInFlight: Promise<ReturnType<typeof queueSummary>> | null = null;

/**
 * Backup-only run for the Backup tab: device diff → hash → enqueue → upload,
 * skipping the heavy remote delta pull (that's what "Sync now" is for). Uploads
 * that land trigger a photos delta so the merged-timeline badge flips. Single-
 * flight of its own; returns the resulting queue summary.
 */
export async function runBackupNow(
  db: AppDatabase,
  userId?: number | null,
  opts: { uploadBudget?: number } = {}
) {
  if (backupInFlight) return backupInFlight;
  const now = Date.now();
  const log = (entry: Parameters<typeof appendSyncLog>[1]) => appendSyncLog(db, entry, Date.now());
  backupInFlight = (async () => {
    try {
      try {
        await syncDeviceMedia(db, getMediaProvider(), {
          now,
          log,
          onProgress: (p) => useSyncStore.getState().setDeviceProgress(p),
        });
      } finally {
        useSyncStore.getState().setDeviceProgress(null);
      }
      if (userId != null) {
        await runHashPass(db, getAssetHasher(), {
          userId,
          now,
          log,
          onBatch: () => enqueueBackups(db),
        });
        await appHooks(userId, opts).topUpUploadQueue?.({
          db,
          source: getSource(),
          now,
          log,
        });
      }
    } catch (err) {
      useSyncStore.getState().setError(err instanceof Error ? err.message : String(err));
    }
    return queueSummary(db);
  })().finally(() => {
    backupInFlight = null;
  });
  return backupInFlight;
}

/** Manual "Repair sync": wipe the mirror and reseed. */
export async function repair(db: AppDatabase, userId?: number | null): Promise<SyncResult | null> {
  useSyncStore.getState().setRunning(true, "manual");
  try {
    const result = await repairSync(db, getSource(), appHooks(userId));
    useSyncStore.getState().setResult(result);
    return result;
  } catch (err) {
    useSyncStore.getState().setError(err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    useSyncStore.getState().setRunning(false);
  }
}
