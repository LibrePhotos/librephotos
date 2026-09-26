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
 * So this module reports the pipelines separately, each against a real total,
 * plus the single thing currently blocking progress:
 *
 *   scanning: how many camera-roll assets are in the mirror, out of the count
 *             the device itself reports (the real 2867, known up front).
 *   hashing : how many selected assets have a file hash yet (md5 over every
 *             byte — minutes on a multi-GB library), out of *all* selected.
 *   iCloud  : how many are parked because their bytes are not on the phone at
 *             all. On an iPhone using "Optimise iPhone Storage" this can be most
 *             of the library, and it must be *said*: hashing deliberately does
 *             not download, so those assets move only when the upload path
 *             fetches them. "1,204 photos waiting to download from iCloud" is a
 *             legitimate state; a bar that stalls without explanation is not.
 *   upload  : how many upload-ready assets have reached the server, out of all
 *             that are ready.
 *   blocker : permission, master toggle, album selection, gate, upload failures,
 *             or a job the queue has given up on.
 *
 * The job queue is the source of truth for "which stage is running" — this
 * module reads its snapshot rather than re-deriving stage state from table
 * counts, so the screen and the worker can never disagree.
 *
 * Pure SQL + plain values so every state is Node-tested.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import type { BackupConfig } from "@/db/queries/backup";
import type { MediaAccess } from "@/sync/device/types";
import { HASH_STATE_ICLOUD } from "@/sync/device/hasher";
import { scanCounts, type JobQueueSnapshot } from "@/sync/jobs/status";
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
  /**
   * Of those, how many are parked because their bytes are in iCloud rather than
   * on the phone. Not a failure and not "waiting for the hasher" — they need a
   * download, which only happens on the upload path. Counted separately so the
   * screen can say "1,204 photos waiting to download from iCloud" instead of
   * showing a hash bar that never reaches its total.
   */
  awaitingRemote: number;
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
  | { kind: "failed"; count: number }
  /** A job the queue has stopped retrying — the only blocker that names itself. */
  | { kind: "job_failed"; count: number; message: string };

/** The headline: which stage is running (or why none is). */
export type BackupStage =
  | { kind: "idle" }
  /** The camera-roll enumeration, against the device's own reported total. */
  | { kind: "scanning"; done: number; total: number }
  | { kind: "hashing"; done: number; total: number }
  | { kind: "uploading"; done: number; total: number; inFlight: number }
  | { kind: "waiting"; pending: number }
  /**
   * Everything readable has been dealt with and what is left lives in iCloud.
   * A real, nameable state — the alternative is a progress bar that stops at
   * 90% and never explains itself.
   */
  | { kind: "icloud"; pending: number }
  | { kind: "up_to_date"; total: number };

export type BackupState = {
  stage: BackupStage;
  blocker: BackupBlocker | null;
  counts: BackupCounts;
  queue: QueueSummary;
  /** Camera-roll scan progress against the device's reported library size. */
  scan: { scanned: number; total: number };
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
               SUM(CASE WHEN la.hash IS NULL AND la.hashed_at IS NULL AND la.hash_state IS NULL
                        THEN 1 ELSE 0 END) AS awaiting_hash,
               SUM(CASE WHEN la.hash IS NULL AND la.hash_state = ${HASH_STATE_ICLOUD}
                        THEN 1 ELSE 0 END) AS awaiting_remote,
               SUM(CASE WHEN la.hash IS NOT NULL AND EXISTS
                     (SELECT 1 FROM remote_photo rp WHERE rp.image_hash = la.hash) THEN 1 ELSE 0 END) AS on_server
        FROM local_asset la
        WHERE ${SELECTED} AND NOT ${EXCLUDED}`
  ) as {
    selected: number;
    hashed: number | null;
    awaiting_hash: number | null;
    awaiting_remote: number | null;
    on_server: number | null;
  };
  const albums = db.get(
    sql`SELECT COUNT(*) AS c FROM local_album WHERE backup_selection = 1`
  ) as { c: number };
  return {
    selected: row?.selected ?? 0,
    hashed: row?.hashed ?? 0,
    awaitingHash: row?.awaiting_hash ?? 0,
    awaitingRemote: row?.awaiting_remote ?? 0,
    onServer: row?.on_server ?? 0,
    selectedAlbums: albums?.c ?? 0,
  };
}

const GATE_BLOCKER: Record<string, BackupBlocker> = {
  offline: { kind: "offline" },
  wifi_required: { kind: "wifi_required" },
  charging_required: { kind: "charging_required" },
};

export type BackupStateOptions = {
  config: BackupConfig;
  access: MediaAccess | null;
  gate?: GateDecision | null;
  /**
   * Live job-queue snapshot. When supplied, "which stage is running" comes from
   * the queue's own in-flight/depth counts rather than being inferred from table
   * totals — the screen and the worker then cannot disagree. Optional so the
   * pure counts path still works before the first drain.
   */
  jobs?: JobQueueSnapshot | null;
};

/**
 * Resolve the current backup state. `gate` is the last decision the engine
 * observed (null when it has not run yet) — a blocked gate is only reported
 * when there is actually work waiting on it.
 */
export function backupState(db: AppDatabase, opts: BackupStateOptions): BackupState {
  const counts = backupCounts(db);
  const queue = queueSummary(db);
  const scan = scanCounts(db);
  const inFlight = queue.uploading + queue.checking;
  const scanning = jobsActive(opts.jobs, "device_scan");
  const hasWork =
    counts.awaitingHash > 0 || queue.pending > 0 || inFlight > 0 || jobsActive(opts.jobs, "upload_asset");

  const blocker = resolveBlocker(opts, counts, queue, hasWork);

  return { stage: resolveStage(counts, queue, scan, inFlight, scanning), blocker, counts, queue, scan };
}

/** True when the queue has a job of this kind pending or running. */
function jobsActive(jobs: JobQueueSnapshot | null | undefined, kind: string): boolean {
  const d = jobs?.depth.find((x) => x.kind === kind);
  return d != null && d.pending + d.running > 0;
}

function resolveBlocker(
  opts: BackupStateOptions,
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
  // A job the queue has given up on outranks a per-item upload failure: it
  // means a whole *stage* has stopped, and it is the only blocker that can say
  // in its own words why.
  const dead = opts.jobs?.failures.filter((f) => f.terminal) ?? [];
  if (dead.length > 0) {
    return {
      kind: "job_failed",
      count: dead.length,
      message: `${dead[0].kind}: ${dead[0].lastError ?? "unknown error"}`,
    };
  }
  if (queue.failed > 0) return { kind: "failed", count: queue.failed };
  return null;
}

function resolveStage(
  counts: BackupCounts,
  queue: QueueSummary,
  scan: { scanned: number; total: number },
  inFlight: number,
  scanning: boolean
): BackupStage {
  // Scanning comes first because it is the stage that produces everything
  // downstream, and because it is the one the old UI was silent about — the
  // user saw "0/161" of a library it had not finished enumerating.
  if (scanning && scan.scanned < scan.total) {
    return { kind: "scanning", done: scan.scanned, total: scan.total };
  }
  if (counts.selected === 0) return { kind: "idle" };
  if (inFlight > 0) {
    return {
      kind: "uploading",
      done: queue.done + queue.skipped_exists,
      total: queue.total,
      inFlight,
    };
  }
  // Hashing gates everything downstream, so it outranks a queue that is merely
  // waiting.
  if (counts.awaitingHash > 0) {
    return { kind: "hashing", done: counts.hashed, total: counts.selected };
  }
  // A queue that is only holding iCloud-parked assets is not "ready to upload":
  // every one of them needs a download first, and saying so is the whole point.
  const localPending = Math.max(0, queue.pending - counts.awaitingRemote);
  if (localPending > 0) return { kind: "waiting", pending: localPending };
  if (counts.awaitingRemote > 0) return { kind: "icloud", pending: counts.awaitingRemote };
  if (queue.pending > 0) return { kind: "waiting", pending: queue.pending };
  return { kind: "up_to_date", total: counts.onServer + queue.done + queue.skipped_exists };
}
