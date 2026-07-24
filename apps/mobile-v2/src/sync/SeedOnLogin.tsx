/**
 * Session sync manager (renders nothing). On login it kicks the initial
 * seed-from-zero (or a catch-up delta if the mirror is already populated) and
 * registers the foreground + connectivity triggers for the session. Runs inside
 * the DbProvider so it shares the mirror handle. The name is kept for the
 * existing _layout mount point; behaviour now spans the whole sync engine
 * (Phase 2) rather than just the Phase 1 seed.
 */
import { useEffect } from "react";
import { useDb } from "@/db/provider";
import { useAuthStore } from "@/stores/auth";
import { needsInitialSeed } from "./orchestrator";
import { runSync, registerDeviceMediaListener } from "./run";
import { registerSyncTriggers } from "./triggers";
import { registerBackgroundTasks } from "./background/tasks";

export function SeedOnLogin() {
  const db = useDb();
  const userId = useAuthStore((s) => s.userId);

  useEffect(() => {
    if (userId == null) return;
    // Initial full seed on first login; a normal catch-up delta otherwise.
    // Single-flight in the orchestrator dedupes against trigger-driven runs.
    void runSync(db, { userId, reason: needsInitialSeed(db) ? "login" : "foreground" });

    const unsubscribe = registerSyncTriggers({
      db,
      getUserId: () => useAuthStore.getState().userId,
    });
    // Camera-roll changes nudge a sync while the app is foregrounded (doc 03 §4).
    const unsubscribeMedia = registerDeviceMediaListener(db, () => useAuthStore.getState().userId);
    // Register the OS background task (idempotent; a top-up, not the main path).
    void registerBackgroundTasks();
    return () => {
      unsubscribe();
      unsubscribeMedia();
    };
  }, [db, userId]);

  return null;
}
