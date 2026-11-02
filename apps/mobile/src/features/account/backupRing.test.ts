import type { BackupState } from "@/sync/upload/status";
import { backupRing } from "./backupRing";

function state(partial: Partial<BackupState>): BackupState {
  return {
    stage: { kind: "idle" },
    blocker: null,
    counts: {
      selected: 10,
      hashed: 10,
      awaitingHash: 0,
      awaitingRemote: 0,
      onServer: 4,
      processingOnServer: 0,
      selectedAlbums: 1,
    },
    queue: { pending: 0, checking: 0, uploading: 0, done: 0, failed: 0, skipped_exists: 0, total: 0 },
    scan: { scanned: 10, total: 10 },
    ...partial,
  };
}

describe("backupRing", () => {
  it("shows no ring while backup is off or not set up", () => {
    expect(backupRing(null).tone).toBe("off");
    expect(backupRing(state({ blocker: { kind: "disabled" } })).tone).toBe("off");
    expect(backupRing(state({ blocker: { kind: "no_access" } })).tone).toBe("off");
    expect(backupRing(state({ blocker: { kind: "no_selection" } })).tone).toBe("off");
    expect(backupRing(state({ stage: { kind: "idle" } })).tone).toBe("off");
  });

  it("fills the arc with upload progress", () => {
    const ring = backupRing(state({ stage: { kind: "uploading", done: 3, total: 12, inFlight: 1 } }));
    expect(ring).toEqual({ tone: "active", progress: 0.25 });
  });

  it("measures waiting work against what the server has", () => {
    expect(backupRing(state({ stage: { kind: "waiting", pending: 6 } }))).toEqual({ tone: "active", progress: 0.4 });
  });

  it("is a full ring when everything is backed up", () => {
    expect(backupRing(state({ stage: { kind: "up_to_date", total: 10 } }))).toEqual({ tone: "done", progress: 1 });
  });

  it("goes muted while waiting on Wi-Fi, charging or a network", () => {
    expect(backupRing(state({ blocker: { kind: "wifi_required" } })).tone).toBe("paused");
    expect(backupRing(state({ blocker: { kind: "offline" } })).tone).toBe("paused");
  });

  it("turns red when uploads failed", () => {
    expect(backupRing(state({ blocker: { kind: "failed", count: 2 } })).tone).toBe("error");
    expect(backupRing(state({ blocker: { kind: "job_failed", count: 1, message: "x" } })).tone).toBe("error");
  });

  it("never draws past a full ring", () => {
    expect(backupRing(state({ stage: { kind: "hashing", done: 20, total: 10 } })).progress).toBe(1);
    expect(backupRing(state({ stage: { kind: "scanning", done: 0, total: 0 } })).progress).toBe(0);
  });
});
