import { create } from "zustand";
import type { SyncProgress, SyncReason, SyncResult } from "@/sync/orchestrator";
import type { DeviceSyncProgress } from "@/sync/device/media-sync";
import type { GateDecision } from "@/sync/upload/gate";
import type { JobQueueSnapshot } from "@/sync/jobs/status";

/**
 * Live sync UI state (client state, not persisted). The orchestrator runner
 * (sync/run) pushes progress + results here so the timeline refresh control and
 * the Sync status screen render current state without touching the DB directly.
 */
type SyncUiState = {
  running: boolean;
  reason: SyncReason | null;
  progress: SyncProgress | null;
  lastResult: SyncResult | null;
  lastError: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /**
   * Camera-roll enumeration progress. Non-null only while the device scan is
   * walking the library, so the Backup screen can say "Scanning 1,200 of 8,000"
   * instead of showing a dead screen (the device-run freeze report).
   */
  deviceProgress: DeviceSyncProgress | null;
  /**
   * Last upload-gate decision observed by the engine. Lets the Backup screen
   * explain "Waiting for Wi-Fi" / "Waiting to charge" rather than silently
   * queueing forever.
   */
  gate: GateDecision | null;
  /**
   * Live job-queue snapshot, refreshed after every job settles. This is what
   * lets the status screens answer "which stage is running, how far along, and
   * what is blocking it" — the questions the old pipeline could not answer
   * because its only state was the call stack.
   */
  queue: JobQueueSnapshot | null;
  setRunning: (running: boolean, reason?: SyncReason | null) => void;
  setProgress: (progress: SyncProgress) => void;
  setDeviceProgress: (progress: DeviceSyncProgress | null) => void;
  setGate: (gate: GateDecision | null) => void;
  setQueue: (queue: JobQueueSnapshot | null) => void;
  setResult: (result: SyncResult) => void;
  setError: (error: string | null) => void;
};

export const useSyncStore = create<SyncUiState>((set) => ({
  running: false,
  reason: null,
  progress: null,
  lastResult: null,
  lastError: null,
  startedAt: null,
  finishedAt: null,
  deviceProgress: null,
  gate: null,
  queue: null,
  setRunning: (running, reason = null) =>
    set((s) => ({
      running,
      reason: running ? reason : s.reason,
      startedAt: running ? Date.now() : s.startedAt,
      finishedAt: running ? null : Date.now(),
      progress: running ? s.progress : null,
      deviceProgress: running ? s.deviceProgress : null,
    })),
  setProgress: (progress) => set({ progress }),
  setDeviceProgress: (deviceProgress) => set({ deviceProgress }),
  setGate: (gate) => set({ gate }),
  setQueue: (queue) => set({ queue }),
  setResult: (lastResult) => set({ lastResult, lastError: null }),
  setError: (lastError) => set({ lastError }),
}));
