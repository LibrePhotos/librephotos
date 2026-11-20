/**
 * One-off "share to LibrePhotos" uploads (doc 05 §Share-sheet target). Images
 * received from the system share sheet are enqueued through the SAME upload
 * worker path as camera-roll backup — but as individual one-offs, not the backup
 * queue. Each shared item becomes a local_asset (hash filled in by the hash pass)
 * attached to a synthetic album so the orphan sweep keeps it, plus a pending
 * upload_queue row the worker drains.
 *
 * Pure SQL (no expo) so the enqueue is Node-tested; the OS→app payload delivery
 * (the shared URIs) is provided by the receiving screen.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@librephotos/local-db";
import { isRecord } from "@/lib/guards";

/** Synthetic album that owns shared one-off uploads (selection 0 = not in the backup timeline). */
export const SHARED_UPLOADS_ALBUM_ID = "__shared_uploads__";

export type SharedUploadItem = {
  /** Stable id for the asset (e.g. the content:// uri or a generated id). */
  id: string;
  uri: string;
  name?: string | null;
  type?: string | null;
  createdAt?: number | null;
};

function ensureSharedAlbumSql(now: number): SQL {
  return sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
             VALUES (${SHARED_UPLOADS_ALBUM_ID}, 'Shared uploads', 0, ${now}, 0)
             ON CONFLICT(id) DO NOTHING`;
}

/**
 * Enqueue shared items for upload. Idempotent per id (existing local_asset /
 * queue rows are left untouched). Returns the number of newly-queued items.
 */
export async function enqueueSharedUploads(db: AppDatabase, items: SharedUploadItem[], now = Date.now()): Promise<number> {
  if (items.length === 0) return 0;
  const results = await db.batch([
    db.run(ensureSharedAlbumSql(now)),
    ...items.flatMap((item) => [
      db.all<{ asset_id: string; queued?: number }>(
        sql`INSERT INTO local_asset (id, name, type, created_at, modified_at, uri, hash, hashed_at)
            VALUES (${item.id}, ${item.name ?? item.id}, ${item.type ?? "image"}, ${item.createdAt ?? now},
                    ${item.createdAt ?? now}, ${item.uri}, NULL, NULL)
            ON CONFLICT(id) DO NOTHING
            RETURNING id AS asset_id`
      ),
      db.all<{ asset_id: string; queued?: number }>(
        sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES (${SHARED_UPLOADS_ALBUM_ID}, ${item.id})
            ON CONFLICT(album_id, asset_id) DO NOTHING
            RETURNING asset_id`
      ),
      db.all<{ asset_id: string; queued: number }>(
        sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
            VALUES (${item.id}, 'pending', 0, 0, ${now})
            ON CONFLICT(asset_id) DO NOTHING
            RETURNING asset_id, 1 AS queued`
      ),
    ]),
    db.run(
      sql`UPDATE local_album SET asset_count = (SELECT COUNT(*) FROM local_album_asset WHERE album_id = ${SHARED_UPLOADS_ALBUM_ID})
          WHERE id = ${SHARED_UPLOADS_ALBUM_ID}`
    ),
  ]);
  let queued = 0;
  for (const result of results) {
    if (Array.isArray(result)) for (const row of result) if (isRecord(row) && row.queued === 1) queued += 1;
  }
  return queued;
}
