/**
 * Upload queue table ops (doc 03 §5). Pure SQL over `upload_queue` +
 * `local_asset` — no expo, no network. The worker (./worker) drives the state
 * machine; this module owns enqueue selection, eligibility, and transitions.
 *
 * Enqueue rule: a local asset that is hashed, lives in a backup-SELECTED album,
 * is NOT in an excluded album, and whose hash has no `remote_photo` counterpart
 * (i.e. "will be backed up but isn't on the server yet").
 *
 * …plus one exception. An asset the hash pass parked as `hash_state = 'icloud'`
 * has no hash *because it has no bytes on this device*, and refusing to queue it
 * would silently drop most of the library on any iPhone using "Optimise iPhone
 * Storage". Those are queued unhashed and sorted last; the worker downloads each
 * one once and hashes the bytes on their way out (see ./worker).
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import { HASH_STATE_ICLOUD } from "@/sync/device/hasher";

export type UploadState =
  | "pending"
  | "checking"
  | "uploading"
  | "done"
  | "failed"
  | "skipped_exists";

/** Cap on retry attempts before an item is parked as permanently failed. */
export const MAX_ATTEMPTS = 5;
/** Backoff base (ms): delay = base * 2^attempts. */
export const BACKOFF_BASE_MS = 30_000;

export function backoffDelay(attempts: number, base = BACKOFF_BASE_MS): number {
  return base * 2 ** Math.max(0, attempts);
}

/**
 * Insert queue rows for every eligible-but-unqueued asset. Idempotent: existing
 * rows (any state) are left untouched. Returns the number newly enqueued.
 */
export function enqueueBackups(db: AppDatabase, now = Date.now()): number {
  const before = countQueued(db);
  db.run(
    sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
        SELECT la.id, 'pending', 0, 0, ${now}
        FROM local_asset la
        WHERE (la.hash IS NOT NULL OR la.hash_state = ${HASH_STATE_ICLOUD})
          AND EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                      WHERE laa.asset_id = la.id AND l.backup_selection = 1)
          AND NOT EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                      WHERE laa.asset_id = la.id AND l.backup_selection = 2)
          AND NOT EXISTS (SELECT 1 FROM remote_photo rp WHERE rp.image_hash = la.hash)
          AND NOT EXISTS (SELECT 1 FROM upload_queue uq WHERE uq.asset_id = la.id)`
  );
  return countQueued(db) - before;
}

function countQueued(db: AppDatabase): number {
  return (db.get(sql`SELECT COUNT(*) AS c FROM upload_queue`) as { c: number }).c;
}

export type QueueItem = {
  asset_id: string;
  state: UploadState;
  attempts: number;
  progress: number;
  uri: string | null;
  name: string | null;
  type: string | null;
  hash: string | null;
  /** `'icloud'` when the bytes still have to be fetched (hash is NULL). */
  hash_state: string | null;
  created_at: number | null;
  modified_at: number | null;
};

export const QUEUE_ITEM_COLUMNS = sql`uq.asset_id AS asset_id, uq.state AS state, uq.attempts AS attempts,
       uq.progress AS progress, la.uri AS uri, la.name AS name, la.type AS type, la.hash AS hash,
       la.hash_state AS hash_state, la.created_at AS created_at, la.modified_at AS modified_at`;

/**
 * Assets that already have a hash go first. An unhashed row is an iCloud-only
 * asset whose bytes must be downloaded before anything can happen, so letting
 * one of those to the front would park the whole serial queue on a network
 * fetch while photos that are sitting right there on the disk wait behind it.
 */
export const LOCAL_FIRST = sql`(CASE WHEN la.hash IS NULL THEN 1 ELSE 0 END) ASC`;

/**
 * The next item eligible to run: a `pending` row, or a `failed` row that is
 * under the attempt cap and past its backoff window. Locally-hashed assets
 * first, then FIFO. Returns null when the queue is drained/blocked.
 */
export function nextEligible(db: AppDatabase, now = Date.now()): QueueItem | null {
  const row = db.get(
    sql`SELECT ${QUEUE_ITEM_COLUMNS}
        FROM upload_queue uq JOIN local_asset la ON la.id = uq.asset_id
        WHERE (uq.state = 'pending'
               OR (uq.state = 'failed' AND uq.attempts < ${MAX_ATTEMPTS}
                   AND (uq.next_attempt_at IS NULL OR uq.next_attempt_at <= ${now})))
        ORDER BY ${LOCAL_FIRST}, uq.enqueued_at ASC, uq.asset_id ASC
        LIMIT 1`
  ) as QueueItem | undefined;
  return row ?? null;
}

export function setQueueState(db: AppDatabase, assetId: string, state: UploadState, progress?: number): void {
  if (progress === undefined) {
    db.run(sql`UPDATE upload_queue SET state = ${state} WHERE asset_id = ${assetId}`);
  } else {
    db.run(sql`UPDATE upload_queue SET state = ${state}, progress = ${progress} WHERE asset_id = ${assetId}`);
  }
}

export function markDone(db: AppDatabase, assetId: string): void {
  db.run(
    sql`UPDATE upload_queue SET state = 'done', progress = 1, last_error = NULL, next_attempt_at = NULL
        WHERE asset_id = ${assetId}`
  );
}

export function markSkipped(db: AppDatabase, assetId: string): void {
  db.run(
    sql`UPDATE upload_queue SET state = 'skipped_exists', progress = 1, last_error = NULL, next_attempt_at = NULL
        WHERE asset_id = ${assetId}`
  );
}

/** Record a failure: bump attempts, set backoff window + error message. */
export function markFailed(
  db: AppDatabase,
  assetId: string,
  error: string,
  now = Date.now(),
  base = BACKOFF_BASE_MS
): void {
  const attempts =
    ((db.get(sql`SELECT attempts FROM upload_queue WHERE asset_id = ${assetId}`) as
      | { attempts: number }
      | undefined)?.attempts ?? 0) + 1;
  db.run(
    sql`UPDATE upload_queue
        SET state = 'failed', attempts = ${attempts}, last_error = ${error},
            next_attempt_at = ${now + backoffDelay(attempts, base)}
        WHERE asset_id = ${assetId}`
  );
}

/** Reset failed/parked items back to pending (user "retry" / resume). Returns how many. */
export function retryFailed(db: AppDatabase): number {
  const n = (db.get(sql`SELECT COUNT(*) AS c FROM upload_queue WHERE state = 'failed'`) as { c: number }).c;
  db.run(
    sql`UPDATE upload_queue SET state = 'pending', attempts = 0, last_error = NULL, next_attempt_at = NULL
        WHERE state = 'failed'`
  );
  return n;
}

export type QueueSummary = {
  pending: number;
  checking: number;
  uploading: number;
  done: number;
  failed: number;
  skipped_exists: number;
  total: number;
};

export function queueSummary(db: AppDatabase): QueueSummary {
  const rows = db.all(
    sql`SELECT state, COUNT(*) AS c FROM upload_queue GROUP BY state`
  ) as { state: UploadState; c: number }[];
  const s: QueueSummary = {
    pending: 0,
    checking: 0,
    uploading: 0,
    done: 0,
    failed: 0,
    skipped_exists: 0,
    total: 0,
  };
  for (const r of rows) {
    s[r.state] = r.c;
    s.total += r.c;
  }
  return s;
}

export type QueueListRow = {
  asset_id: string;
  state: UploadState;
  progress: number;
  attempts: number;
  last_error: string | null;
  name: string | null;
  uri: string | null;
  type: string | null;
};

/** Queue rows for the Backup screen (active/failed first, newest last). */
export function queueList(db: AppDatabase, limit = 200): QueueListRow[] {
  return db.all(
    sql`SELECT uq.asset_id AS asset_id, uq.state AS state, uq.progress AS progress, uq.attempts AS attempts,
               uq.last_error AS last_error, la.name AS name, la.uri AS uri, la.type AS type
        FROM upload_queue uq LEFT JOIN local_asset la ON la.id = uq.asset_id
        ORDER BY
          CASE uq.state WHEN 'uploading' THEN 0 WHEN 'checking' THEN 1 WHEN 'pending' THEN 2
                        WHEN 'failed' THEN 3 WHEN 'skipped_exists' THEN 4 ELSE 5 END ASC,
          uq.enqueued_at ASC
        LIMIT ${limit}`
  ) as QueueListRow[];
}
