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

export const MAX_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 30_000;

export function backoffDelay(attempts: number, base = BACKOFF_BASE_MS): number {
  return base * 2 ** Math.max(0, attempts);
}

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
  hash_state: string | null;
  created_at: number | null;
  modified_at: number | null;
};

export const QUEUE_ITEM_COLUMNS = sql`uq.asset_id AS asset_id, uq.state AS state, uq.attempts AS attempts,
       uq.progress AS progress, la.uri AS uri, la.name AS name, la.type AS type, la.hash AS hash,
       la.hash_state AS hash_state, la.created_at AS created_at, la.modified_at AS modified_at`;

export const LOCAL_FIRST = sql`(CASE WHEN la.hash IS NULL THEN 1 ELSE 0 END) ASC`;

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
  processing: number;
};

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

export type ClaimedUpload = QueueItem & { upload_id: string | null; upload_offset: number; size_bytes: number | null };

const CLAIMED_COLUMNS = sql`${QUEUE_ITEM_COLUMNS}, uq.upload_id AS upload_id, uq.upload_offset AS upload_offset,
       la.size_bytes AS size_bytes`;

function eligible(now: number): SQL {
  return sql`(uq.state = 'pending'
              OR (uq.state = 'failed' AND uq.attempts < ${MAX_ATTEMPTS}
                  AND (uq.next_attempt_at IS NULL OR uq.next_attempt_at <= ${now})))`;
}

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

export async function claimExistenceChecks(
  db: AppDatabase,
  limit: number
): Promise<{ asset_id: string; hash: string }[]> {
  const ids = await db.all<{ asset_id: string }>(
    sql`UPDATE upload_queue SET state = 'checking'
        WHERE asset_id IN (
          SELECT uq.asset_id FROM upload_queue uq JOIN local_asset la ON la.id = uq.asset_id
          WHERE uq.state = 'pending' AND uq.attempts = 0 AND uq.next_attempt_at IS NULL AND la.hash IS NOT NULL
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

export async function markAbsent(db: AppDatabase, assetId: string): Promise<void> {
  await db.run(
    sql`UPDATE upload_queue SET state = 'pending', next_attempt_at = 0 WHERE asset_id = ${assetId} AND state = 'checking'`
  );
}

export async function cancelFolderBackups(db: AppDatabase): Promise<number> {
  const { changes } = await runWrite(
    db,
    sql`DELETE FROM upload_queue
        WHERE state IN ('pending', 'checking', 'failed')
          AND asset_id IN (SELECT laa.asset_id FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                           WHERE l.source = 'folder')
          AND asset_id NOT IN (SELECT laa.asset_id FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                               WHERE l.source = 'folder' AND l.backup_selection = 1)`
  );
  return changes;
}

export async function recordServerHas(
  db: AppDatabase,
  assetId: string,
  serverPhotoId: string | null,
  now = Date.now()
): Promise<void> {
  await db.run(
    sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at, server_photo_id)
        VALUES (${assetId}, 'skipped_exists', 1, 0, ${now}, ${serverPhotoId})
        ON CONFLICT(asset_id) DO UPDATE SET state = 'skipped_exists', progress = 1, last_error = NULL,
          next_attempt_at = NULL, server_photo_id = excluded.server_photo_id
        WHERE upload_queue.state <> 'uploading'`
  );
}

export async function switchFolderAccount(db: AppDatabase, userId: number): Promise<void> {
  await db.batch([
    db.run(
      sql`UPDATE local_asset SET hash = substr(hash, 1, 32) || ${String(userId)}
          WHERE hash IS NOT NULL AND length(hash) > 32 AND uri IS NOT NULL`
    ),
    db.run(sql`DELETE FROM upload_queue`),
  ]);
}

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

export async function resetInFlightUploads(db: AppDatabase): Promise<number> {
  const { changes } = await runWrite(
    db,
    sql`UPDATE upload_queue SET state = 'pending' WHERE state IN ('checking', 'uploading')`
  );
  return changes;
}

export type LocalBackupCounts = {
  total: number;
  hashed: number;
  onServer: number;
  pending: number;
  checking: number;
  uploading: number;
  failed: number;
  pendingBytes: number;
};

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

export async function requestUpload(db: AppDatabase, assetId: string, now = Date.now()): Promise<void> {
  await db.run(
    sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
        VALUES (${assetId}, 'pending', 0, 0, ${now})
        ON CONFLICT(asset_id) DO UPDATE SET state = 'pending', attempts = 0, next_attempt_at = NULL, last_error = NULL
        WHERE upload_queue.state = 'failed'`
  );
}
