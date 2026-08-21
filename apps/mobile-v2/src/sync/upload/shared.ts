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
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";

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

function ensureSharedAlbum(tx: AppDatabase, now: number): void {
  tx.run(
    sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
        VALUES (${SHARED_UPLOADS_ALBUM_ID}, 'Shared uploads', 0, ${now}, 0)
        ON CONFLICT(id) DO NOTHING`
  );
}

/**
 * Enqueue shared items for upload. Idempotent per id (existing local_asset /
 * queue rows are left untouched). Returns the number of newly-queued items.
 */
export function enqueueSharedUploads(db: AppDatabase, items: SharedUploadItem[], now = Date.now()): number {
  if (items.length === 0) return 0;
  let queued = 0;
  db.transaction((tx) => {
    ensureSharedAlbum(tx, now);
    for (const item of items) {
      tx.run(
        sql`INSERT INTO local_asset (id, name, type, created_at, modified_at, uri, hash, hashed_at)
            VALUES (${item.id}, ${item.name ?? item.id}, ${item.type ?? "image"}, ${item.createdAt ?? now},
                    ${item.createdAt ?? now}, ${item.uri}, NULL, NULL)
            ON CONFLICT(id) DO NOTHING`
      );
      tx.run(
        sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES (${SHARED_UPLOADS_ALBUM_ID}, ${item.id})
            ON CONFLICT(album_id, asset_id) DO NOTHING`
      );
      const res = tx.run(
        sql`INSERT INTO upload_queue (asset_id, state, progress, attempts, enqueued_at)
            VALUES (${item.id}, 'pending', 0, 0, ${now})
            ON CONFLICT(asset_id) DO NOTHING`
      ) as { changes?: number };
      if (res?.changes) queued += 1;
    }
    tx.run(
      sql`UPDATE local_album SET asset_count = (SELECT COUNT(*) FROM local_album_asset WHERE album_id = ${SHARED_UPLOADS_ALBUM_ID})
          WHERE id = ${SHARED_UPLOADS_ALBUM_ID}`
    );
  });
  return queued;
}
