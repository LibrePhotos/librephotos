/**
 * Sync triggers (doc 03 §1). Wires the orchestrator to the runtime events that
 * should kick a sync:
 *
 *   - app foreground   → throttled to ≥1 min (expo AppState 'active')
 *   - connectivity     → regained network (expo-network listener)
 *   - outbox write     → after a local mutation (Phase 4 calls notifyOutboxWrite)
 *
 * Pull-to-refresh (forced) is triggered directly from the timeline screen, not
 * here. All runs go through the orchestrator's single-flight mutex, so
 * overlapping triggers coalesce onto one in-flight run.
 *
 * App-only: imports react-native AppState + expo-network. The Node unit tests
 * never import this module.
 */
import { AppState, type AppStateStatus } from "react-native";
import { addNetworkStateListener } from "expo-network";
import type { AppDatabase } from "@/db/types";
import { runSync } from "./run";
import type { SyncReason } from "./orchestrator";
import { createThrottle, FOREGROUND_THROTTLE_MS } from "./throttle";

export { FOREGROUND_THROTTLE_MS };

export type TriggerDeps = {
  db: AppDatabase;
  /** Current signed-in user id (null when logged out). */
  getUserId: () => number | null;
};

function fire(deps: TriggerDeps, reason: SyncReason): void {
  void runSync(deps.db, { userId: deps.getUserId(), reason });
}

/**
 * Register the foreground + connectivity triggers. Returns an unsubscribe fn.
 * Idempotent per subscription — mount once (e.g. from the authed layout).
 */
export function registerSyncTriggers(deps: TriggerDeps): () => void {
  const foregroundThrottle = createThrottle(FOREGROUND_THROTTLE_MS);
  const appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state !== "active") return;
    if (!foregroundThrottle.tryRun()) return;
    fire(deps, "foreground");
  });

  let wasConnected = true;
  const netSub = addNetworkStateListener(({ isConnected }) => {
    const connected = isConnected === true;
    if (connected && !wasConnected) fire(deps, "connectivity");
    wasConnected = connected;
  });

  return () => {
    appStateSub.remove();
    netSub.remove();
  };
}

/**
 * Trigger a sync after an outbox write (Phase 4). Replay-first ordering means
 * the orchestrator pushes the mutation before the next pull.
 */
export function notifyOutboxWrite(deps: TriggerDeps): void {
  fire(deps, "outbox");
}
