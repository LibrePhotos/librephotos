import { create } from "zustand";
import type { SyncProgress, SyncReason, SyncResult } from "@/sync/orchestrator";

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
  setRunning: (running: boolean, reason?: SyncReason | null) => void;
  setProgress: (progress: SyncProgress) => void;
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
  setRunning: (running, reason = null) =>
    set((s) => ({
      running,
      reason: running ? reason : s.reason,
      startedAt: running ? Date.now() : s.startedAt,
      finishedAt: running ? null : Date.now(),
      progress: running ? s.progress : null,
    })),
  setProgress: (progress) => set({ progress }),
  setResult: (lastResult) => set({ lastResult, lastError: null }),
  setError: (lastError) => set({ lastError }),
}));
