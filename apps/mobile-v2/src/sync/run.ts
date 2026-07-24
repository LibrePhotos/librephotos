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
import {
  repairSync,
  syncAll,
  type SyncAllOptions,
  type SyncReason,
  type SyncResult,
} from "./orchestrator";
import { createApiSyncSource, type RemoteSyncSource } from "./remote/source";
import { replayOutbox } from "./outbox/replay";
import { prefetchNewThumbs } from "./thumb-prefetch";

let source: RemoteSyncSource | null = null;
function getSource(): RemoteSyncSource {
  return (source ??= createApiSyncSource(apiClient));
}

/** Build the injected hooks shared by every app-side run. */
function appHooks(userId: number | null | undefined): SyncAllOptions {
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
