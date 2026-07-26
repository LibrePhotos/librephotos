/**
 * "Why is nothing being backed up?" — the pure state machine behind the Backup
 * screen's status text (doc 03 §5).
 *
 * The device run turned up a screen that could not explain itself: the master
 * toggle defaults to OFF, so selecting an album did nothing and said nothing;
 * and the only progress shown was `on_server / hashed` — a fraction whose
 * denominator *grows as hashing proceeds*, so "0/161" on a 2867-photo album read
 * as "nearly there" when it was 6% through stage one of two.
 *
 * So this module reports the two pipelines separately, each against a real
 * total, plus the single thing currently blocking progress:
 *
 *   hashing : how many selected assets have a file hash yet (md5 over every
 *             byte — minutes on a multi-GB library), out of *all* selected.
 *   upload  : how many upload-ready assets have reached the server, out of all
 *             that are ready.
 *   blocker : permission, master toggle, album selection, gate, or failures.
 *
 * Pure SQL + plain values so every state is Node-tested.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import type { BackupConfig } from "@/db/queries/backup";
import type { MediaAccess } from "@/sync/device/types";
import type { GateDecision } from "./gate";
import { queueSummary, type QueueSummary } from "./queue";

/** Counts over the assets the user actually asked to back up. */
export type BackupCounts = {
  /** Assets in a backup-selected, non-excluded album. */
  selected: number;
  /** Of those, how many have a file hash (upload-eligible). */
  hashed: number;
  /** Of those, how many are still waiting for the hash pass. */
  awaitingHash: number;
  /** Of those, how many already exist on the server. */
  onServer: number;
  /** How many albums are marked "back this up". */
  selectedAlbums: number;
};

export type BackupBlocker =
  | { kind: "no_access" }
  | { kind: "disabled" }
  | { kind: "no_selection" }
  | { kind: "offline" }
  | { kind: "wifi_required" }
  | { kind: "charging_required" }
  | { kind: "failed"; count: number };

/** The headline: which stage is running (or why none is). */
export type BackupStage =
  | { kind: "idle" }
  | { kind: "hashing"; done: number; total: number }
  | { kind: "uploading"; done: number; total: number; inFlight: number }
  | { kind: "waiting"; pending: number }
  | { kind: "up_to_date"; total: number };

export type BackupState = {
  stage: BackupStage;
  blocker: BackupBlocker | null;
  counts: BackupCounts;
  queue: QueueSummary;
};

/** Membership predicates shared with the enqueue rule in ./queue. */
const SELECTED = sql`EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                             WHERE laa.asset_id = la.id AND l.backup_selection = 1)`;
const EXCLUDED = sql`EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                             WHERE laa.asset_id = la.id AND l.backup_selection = 2)`;

/** Counts over the backup-selected asset set (the real denominators). */
export function backupCounts(db: AppDatabase): BackupCounts {
  const row = db.get(
    sql`SELECT COUNT(*) AS selected,
               SUM(CASE WHEN la.hash IS NOT NULL THEN 1 ELSE 0 END) AS hashed,
               SUM(CASE WHEN la.hash IS NULL AND la.hashed_at IS NULL THEN 1 ELSE 0 END) AS awaiting_hash,
               SUM(CASE WHEN la.hash IS NOT NULL AND EXISTS
                     (SELECT 1 FROM remote_photo rp WHERE rp.image_hash = la.hash) THEN 1 ELSE 0 END) AS on_server
        FROM local_asset la
        WHERE ${SELECTED} AND NOT ${EXCLUDED}`
  ) as { selected: number; hashed: number | null; awaiting_hash: number | null; on_server: number | null };
  const albums = db.get(
    sql`SELECT COUNT(*) AS c FROM local_album WHERE backup_selection = 1`
  ) as { c: number };
  return {
    selected: row?.selected ?? 0,
    hashed: row?.hashed ?? 0,
    awaitingHash: row?.awaiting_hash ?? 0,
    onServer: row?.on_server ?? 0,
    selectedAlbums: albums?.c ?? 0,
  };
}

const GATE_BLOCKER: Record<string, BackupBlocker> = {
  offline: { kind: "offline" },
  wifi_required: { kind: "wifi_required" },
  charging_required: { kind: "charging_required" },
};

/**
 * Resolve the current backup state. `gate` is the last decision the engine
 * observed (null when it has not run yet) — a blocked gate is only reported
 * when there is actually work waiting on it.
 */
export function backupState(
  db: AppDatabase,
  opts: { config: BackupConfig; access: MediaAccess | null; gate?: GateDecision | null }
): BackupState {
  const counts = backupCounts(db);
  const queue = queueSummary(db);
  const inFlight = queue.uploading + queue.checking;
  const hasWork = counts.awaitingHash > 0 || queue.pending > 0 || inFlight > 0;

  const blocker = resolveBlocker(opts, counts, queue, hasWork);

  return { stage: resolveStage(counts, queue, inFlight), blocker, counts, queue };
}

function resolveBlocker(
  opts: { config: BackupConfig; access: MediaAccess | null; gate?: GateDecision | null },
  counts: BackupCounts,
  queue: QueueSummary,
  hasWork: boolean
): BackupBlocker | null {
  // Ordered by how fundamental the obstacle is: no photos → no permission to
  // read them → the master switch → nothing chosen → the device gate → errors.
  if (opts.access == null || opts.access === "none") return { kind: "no_access" };
  if (!opts.config.enabled) return { kind: "disabled" };
  if (counts.selectedAlbums === 0) return { kind: "no_selection" };
  const gate = opts.gate;
  if (gate && gate.allowed === false && hasWork) {
    return GATE_BLOCKER[gate.reason] ?? { kind: "offline" };
  }
  if (queue.failed > 0) return { kind: "failed", count: queue.failed };
  return null;
}

function resolveStage(counts: BackupCounts, queue: QueueSummary, inFlight: number): BackupStage {
  if (counts.selected === 0) return { kind: "idle" };
  if (inFlight > 0) {
    return {
      kind: "uploading",
      done: queue.done + queue.skipped_exists,
      total: queue.total,
      inFlight,
    };
  }
  // Hashing is stage one and gates everything downstream, so it outranks a
  // queue that is merely waiting.
  if (counts.awaitingHash > 0) {
    return { kind: "hashing", done: counts.hashed, total: counts.selected };
  }
  if (queue.pending > 0) return { kind: "waiting", pending: queue.pending };
  return { kind: "up_to_date", total: counts.onServer + queue.done + queue.skipped_exists };
}
