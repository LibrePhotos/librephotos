import type { BackupState } from "@/sync/upload/status";

/**
 * What the ring around the avatar says about backup, at a glance (the phone
 * counterpart of the web's worker ring, #2186):
 *
 *   off     no ring: backup is off, nothing chosen, or no photo access
 *   active  a partial arc: scanning, preparing or uploading, with progress
 *   done    a full ring: everything selected is on the server
 *   paused  a full muted ring: work is waiting on Wi-Fi, charging or network
 *   error   a full red ring: uploads failed or a stage gave up
 */
export type RingTone = "off" | "active" | "done" | "paused" | "error";

export type BackupRing = {
  tone: RingTone;
  /** 0..1 for the arc; only meaningful while `active`. */
  progress: number;
};

const OFF: BackupRing = { tone: "off", progress: 0 };

function fraction(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, done / total));
}

export function backupRing(state: BackupState | null | undefined): BackupRing {
  if (!state) return OFF;
  const { blocker, stage } = state;
  if (blocker) {
    switch (blocker.kind) {
      case "no_access":
      case "disabled":
      case "no_selection":
        return OFF;
      case "failed":
      case "job_failed":
        return { tone: "error", progress: 1 };
      case "offline":
      case "wifi_required":
      case "charging_required":
        return { tone: "paused", progress: 1 };
    }
  }
  switch (stage.kind) {
    case "idle":
      return OFF;
    case "scanning":
    case "hashing":
    case "uploading":
      return { tone: "active", progress: fraction(stage.done, stage.total) };
    case "waiting":
    case "icloud":
      return { tone: "active", progress: fraction(state.counts.onServer, state.counts.selected) };
    case "processing":
      return { tone: "active", progress: fraction(stage.uploaded, stage.uploaded + stage.processing) };
    case "up_to_date":
      return { tone: "done", progress: 1 };
  }
}
