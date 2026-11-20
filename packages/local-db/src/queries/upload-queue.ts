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
import { sql, type SQL } from "drizzle-orm";
import { runWrite } from "../database";
import type { AppDatabase } from "../types";
import { HASH_STATE_ICLOUD } from "../schema";
import { PROCESSING_ON_SERVER } from "./upload-processing";

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
export async function enqueueBackups(db: AppDatabase, now = Date.now()): Promise<number> {
  const { changes } = await runWrite(
    db,
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
  return changes;
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
export async function nextEligible(db: AppDatabase, now = Date.now()): Promise<QueueItem | null> {
  const row = await db.get<QueueItem | undefined>(
    sql`SELECT ${QUEUE_ITEM_COLUMNS}
        FROM upload_queue uq JOIN local_asset la ON la.id = uq.asset_id
        WHERE (uq.state = 'pending'
               OR (uq.state = 'failed' AND uq.attempts < ${MAX_ATTEMPTS}
                   AND (uq.next_attempt_at IS NULL OR uq.next_attempt_at <= ${now})))
        ORDER BY ${LOCAL_FIRST}, uq.enqueued_at ASC, uq.asset_id ASC
        LIMIT 1`
  );
  return row ?? null;
}

export async function setQueueState(db: AppDatabase, assetId: string, state: UploadState, progress?: number): Promise<void> {
  if (progress === undefined) {
    await db.run(sql`UPDATE upload_queue SET state = ${state} WHERE asset_id = ${assetId}`);
  } else {
    await db.run(sql`UPDATE upload_queue SET state = ${state}, progress = ${progress} WHERE asset_id = ${assetId}`);
  }
}

/**
 * The bytes are on the server. `serverPhotoId` is the photo the completion
 * answered with; the row counts as "processing on the server" until the mirror
 * has that photo with a thumbnail (see db/queries/upload-processing).
 */
export async function markDone(db: AppDatabase, assetId: string, serverPhotoId: string | null): Promise<void> {
  await db.run(
    sql`UPDATE upload_queue SET state = 'done', progress = 1, last_error = NULL, next_attempt_at = NULL,
               server_photo_id = ${serverPhotoId}, server_ready_at = NULL, upload_id = NULL, upload_offset = 0
        WHERE asset_id = ${assetId}`
  );
}

export async function markSkipped(db: AppDatabase, assetId: string): Promise<void> {
  await db.run(
    sql`UPDATE upload_queue SET state = 'skipped_exists', progress = 1, last_error = NULL, next_attempt_at = NULL
        WHERE asset_id = ${assetId}`
  );
}

/** Record a failure: bump attempts, set backoff window + error message. */
export async function markFailed(
  db: AppDatabase,
  assetId: string,
  error: string,
  now = Date.now(),
  base = BACKOFF_BASE_MS
): Promise<void> {
  const attempts =
    (((await db.get<{ attempts: number } | undefined>(sql`SELECT attempts FROM upload_queue WHERE asset_id = ${assetId}`)))?.attempts ?? 0) + 1;
  await db.run(
    sql`UPDATE upload_queue
        SET state = 'failed', attempts = ${attempts}, last_error = ${error},
            next_attempt_at = ${now + backoffDelay(attempts, base)}
        WHERE asset_id = ${assetId}`
  );
}

/** Reset failed/parked items back to pending (user "retry" / resume). Returns how many. */
export async function retryFailed(db: AppDatabase): Promise<number> {
  const { changes } = await runWrite(
    db,
    sql`UPDATE upload_queue SET state = 'pending', attempts = 0, last_error = NULL, next_attempt_at = NULL
        WHERE state = 'failed'`
  );
  return changes;
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

export const EMPTY_QUEUE_SUMMARY: QueueSummary = Object.freeze({
  pending: 0,
  checking: 0,
  uploading: 0,
  done: 0,
  failed: 0,
  skipped_exists: 0,
  total: 0,
});

export async function queueSummary(db: AppDatabase): Promise<QueueSummary> {
  const rows = await db.all<{ state: UploadState; c: number }>(
    sql`SELECT state, COUNT(*) AS c FROM upload_queue GROUP BY state`
  );
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
  /** 1 while the server is still processing this upload (#2740), else 0. */
  processing: number;
};

/** Queue rows for the Backup screen (active/failed first, newest last). */
export async function queueList(db: AppDatabase, limit = 200): Promise<QueueListRow[]> {
  return await db.all<QueueListRow>(
    sql`SELECT uq.asset_id AS asset_id, uq.state AS state, uq.progress AS progress, uq.attempts AS attempts,
               uq.last_error AS last_error, la.name AS name, la.uri AS uri, la.type AS type,
               CASE WHEN ${sql.raw(PROCESSING_ON_SERVER)} THEN 1 ELSE 0 END AS processing
        FROM upload_queue uq LEFT JOIN local_asset la ON la.id = uq.asset_id
        ORDER BY
          CASE uq.state WHEN 'uploading' THEN 0 WHEN 'checking' THEN 1 WHEN 'pending' THEN 2
                        WHEN 'failed' THEN 3 WHEN 'skipped_exists' THEN 4 ELSE 5 END ASC,
          uq.enqueued_at ASC
        LIMIT ${limit}`
  );
}

/* ---- concurrent workers (the desktop) ----------------------------------- */

/** A claimed upload, with where a resumable upload left off. */
export type ClaimedUpload = QueueItem & { upload_id: string | null; upload_offset: number; size_bytes: number | null };

const CLAIMED_COLUMNS = sql`${QUEUE_ITEM_COLUMNS}, uq.upload_id AS upload_id, uq.upload_offset AS upload_offset,
       la.size_bytes AS size_bytes`;

/** Eligible to upload: pending, or failed under the cap and past its backoff. */
function eligible(now: number): SQL {
  return sql`(uq.state = 'pending'
              OR (uq.state = 'failed' AND uq.attempts < ${MAX_ATTEMPTS}
                  AND (uq.next_attempt_at IS NULL OR uq.next_attempt_at <= ${now})))`;
}

/**
 * Atomically claim the next upload for one of several concurrent workers: the
 * row moves to `uploading` in the same statement that picks it, so two workers
 * can never get the same row. A file whose hash is already being uploaded by
 * another row (two copies of one picture) waits. Null when nothing is ready.
 */
export async function claimNextUpload(db: AppDatabase, now = Date.now()): Promise<ClaimedUpload | null> {
  const [claimed] = await db.all<{ asset_id: string }>(
    sql`UPDATE upload_queue SET state = 'uploading'
        WHERE asset_id = (
          SELECT uq.asset_id FROM upload_queue uq JOIN local_asset la ON la.id = uq.asset_id
          WHERE ${eligible(now)}
            AND (la.hash IS NULL OR NOT EXISTS (
                  SELECT 1 FROM upload_queue u2 JOIN local_asset l2 ON l2.id = u2.asset_id
                  WHERE u2.state = 'uploading' AND l2.hash = la.hash))
          ORDER BY ${LOCAL_FIRST}, uq.enqueued_at ASC, uq.asset_id ASC
          LIMIT 1)
        RETURNING asset_id`
  );
  if (!claimed) return null;
  const row = await db.get<ClaimedUpload | undefined>(
    sql`SELECT ${CLAIMED_COLUMNS} FROM upload_queue uq JOIN local_asset la ON la.id = uq.asset_id
        WHERE uq.asset_id = ${claimed.asset_id}`
  );
  return row ?? null;
}

/**
 * Atomically claim up to `limit` hashed pending rows for a server existence
 * check (`checking`). The checker answers each with markSkipped (the server has
 * it) or setQueueState(id, 'pending') (it does not; upload it).
 */
export async function claimExistenceChecks(
  db: AppDatabase,
  limit: number
): Promise<{ asset_id: string; hash: string }[]> {
  const ids = await db.all<{ asset_id: string }>(
    sql`UPDATE upload_queue SET state = 'checking'
        WHERE asset_id IN (
          SELECT uq.asset_id FROM upload_queue uq JOIN local_asset la ON la.id = uq.asset_id
          WHERE uq.state = 'pending' AND uq.attempts = 0 AND la.hash IS NOT NULL
          ORDER BY uq.enqueued_at ASC, uq.asset_id ASC LIMIT ${limit})
        RETURNING asset_id`
  );
  if (ids.length === 0) return [];
  return db.all<{ asset_id: string; hash: string }>(
    sql`SELECT uq.asset_id AS asset_id, la.hash AS hash FROM upload_queue uq JOIN local_asset la ON la.id = uq.asset_id
        WHERE uq.asset_id IN (${sql.join(
          ids.map((r) => sql`${r.asset_id}`),
          sql`, `
        )})`
  );
}

/** Record how far a resumable upload got, so a restart continues from there. */
export async function setUploadProgress(
  db: AppDatabase,
  assetId: string,
  progress: { uploadId: string; offset: number; fraction?: number }
): Promise<void> {
  await db.run(
    sql`UPDATE upload_queue SET upload_id = ${progress.uploadId}, upload_offset = ${progress.offset},
          progress = COALESCE(${progress.fraction ?? null}, progress)
        WHERE asset_id = ${assetId}`
  );
}

/**
 * Work a previous run was doing when it stopped starts over: checks are asked
 * again, uploads go back to pending and resume from their saved offset. Run at
 * startup, before any worker claims. Returns how many rows it reset.
 */
export async function resetInFlightUploads(db: AppDatabase): Promise<number> {
  const { changes } = await runWrite(
    db,
    sql`UPDATE upload_queue SET state = 'pending' WHERE state IN ('checking', 'uploading')`
  );
  return changes;
}

/** What the backup status shows for a set of local assets. */
export type LocalBackupCounts = {
  /** Local assets in scope. */
  total: number;
  /** ...of which hashed. */
  hashed: number;
  /** ...on the server: the mirror has the hash, or the upload finished / the server had it. */
  onServer: number;
  pending: number;
  checking: number;
  uploading: number;
  failed: number;
  /** Bytes not on the server yet (pending, checking, uploading or failed rows). */
  pendingBytes: number;
};

/**
 * Backup counts over the local assets of one source: `'folder'` (the desktop
 * library), `'device'` (the camera roll), or every local asset.
 */
export async function localBackupCounts(db: AppDatabase, source?: "device" | "folder"): Promise<LocalBackupCounts> {
  const scope = source
    ? sql`EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                  WHERE laa.asset_id = la.id AND l.source = ${source})`
    : sql`1 = 1`;
  const row = await db.get<
    | {
        total: number;
        hashed: number | null;
        on_server: number | null;
        pending: number | null;
        checking: number | null;
        uploading: number | null;
        failed: number | null;
        pending_bytes: number | null;
      }
    | undefined
  >(
    sql`SELECT COUNT(*) AS total,
               SUM(la.hash IS NOT NULL) AS hashed,
               SUM(EXISTS (SELECT 1 FROM remote_photo rp WHERE la.hash IS NOT NULL AND rp.image_hash = la.hash)
                   OR uq.state IN ('done', 'skipped_exists')) AS on_server,
               SUM(uq.state = 'pending') AS pending,
               SUM(uq.state = 'checking') AS checking,
               SUM(uq.state = 'uploading') AS uploading,
               SUM(uq.state = 'failed') AS failed,
               SUM(CASE WHEN uq.state IN ('pending', 'checking', 'uploading', 'failed')
                        THEN COALESCE(la.size_bytes, 0) ELSE 0 END) AS pending_bytes
        FROM local_asset la LEFT JOIN upload_queue uq ON uq.asset_id = la.id
        WHERE ${scope}`
  );
  return {
    total: row?.total ?? 0,
    hashed: row?.hashed ?? 0,
    onServer: row?.on_server ?? 0,
    pending: row?.pending ?? 0,
    checking: row?.checking ?? 0,
    uploading: row?.uploading ?? 0,
    failed: row?.failed ?? 0,
    pendingBytes: row?.pending_bytes ?? 0,
  };
}

/**
 * Queue one file for upload whatever its album says (the desktop's "upload
 * this" on a loose or unselected file). A finished or parked row is re-armed.
 */
export async function requestUpload(db: AppDatabase, assetId: string, now = Date.now()): Promise<void> {
  await db.run(
    sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
        VALUES (${assetId}, 'pending', 0, 0, ${now})
        ON CONFLICT(asset_id) DO UPDATE SET state = 'pending', attempts = 0, next_attempt_at = NULL, last_error = NULL
        WHERE upload_queue.state = 'failed'`
  );
}
