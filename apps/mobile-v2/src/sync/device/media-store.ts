/**
 * Pure SQLite writers + read helpers for the local-media tables
 * (local_asset / local_album / local_album_asset), doc 02 §2. No expo imports —
 * driven by {@link MediaProvider} data from the caller, so the whole camera-roll
 * diff runs against better-sqlite3 under Node.
 *
 * Hash invalidation lives here: an upsert whose `modifiedAt` differs from the
 * stored value clears `hash`/`hashed_at`, so the hash pipeline re-picks the row
 * (doc 03 §4).
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";
import type { MediaAsset } from "./types";

export type BackupSelection = 0 | 1 | 2; // 0 none | 1 selected | 2 excluded

const typeToDb = (t: MediaAsset["type"]): string => t;

/** Upsert one album row, PRESERVING its user-chosen backup_selection. */
export function upsertLocalAlbum(
  db: AppDatabase,
  album: { id: string; title: string; assetCount: number; modifiedAt: number }
): void {
  db.run(
    sql`INSERT INTO local_album (id, title, asset_count, modified_at, backup_selection)
        VALUES (${album.id}, ${album.title}, ${album.assetCount}, ${album.modifiedAt}, 0)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          asset_count = excluded.asset_count,
          modified_at = excluded.modified_at`
  );
}

/**
 * Upsert asset rows. On a `modified_at` change the stored hash is invalidated
 * (set NULL) so the row is re-hashed. Runs in one transaction for the batch.
 */
export function upsertLocalAssets(db: AppDatabase, assets: MediaAsset[]): void {
  if (assets.length === 0) return;
  db.transaction((tx) => {
    for (const a of assets) {
      tx.run(
        sql`INSERT INTO local_asset
              (id, name, type, created_at, modified_at, width, height, duration_ms, uri, hash, hashed_at)
            VALUES (${a.id}, ${a.filename}, ${typeToDb(a.type)}, ${a.creationTime}, ${a.modificationTime},
              ${a.width}, ${a.height}, ${Math.round(a.duration * 1000)}, ${a.uri}, NULL, NULL)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name, type = excluded.type, created_at = excluded.created_at,
              width = excluded.width, height = excluded.height, duration_ms = excluded.duration_ms,
              uri = excluded.uri,
              -- Invalidate the hash iff the file changed (modified_at moved).
              hash = CASE WHEN local_asset.modified_at = excluded.modified_at THEN local_asset.hash ELSE NULL END,
              hashed_at = CASE WHEN local_asset.modified_at = excluded.modified_at THEN local_asset.hashed_at ELSE NULL END,
              modified_at = excluded.modified_at`
      );
    }
  });
}

/** Link assets to an album (idempotent). */
export function linkAlbumAssets(db: AppDatabase, albumId: string, assetIds: string[]): void {
  if (assetIds.length === 0) return;
  db.transaction((tx) => {
    for (const assetId of assetIds) {
      tx.run(
        sql`INSERT INTO local_album_asset (album_id, asset_id) VALUES (${albumId}, ${assetId})
            ON CONFLICT(album_id, asset_id) DO NOTHING`
      );
    }
  });
}

/** Remove album↔asset links (an asset removed from this album). */
export function unlinkAlbumAssets(db: AppDatabase, albumId: string, assetIds: string[]): void {
  if (assetIds.length === 0) return;
  db.transaction((tx) => {
    for (const assetId of assetIds) {
      tx.run(sql`DELETE FROM local_album_asset WHERE album_id = ${albumId} AND asset_id = ${assetId}`);
    }
  });
}

/**
 * Which of `ids` already have a row in `local_asset`. Asked *before* an upsert
 * so the device sync can report how many assets are genuinely new rather than
 * counting every re-seen asset as an addition. Chunked to stay under SQLite's
 * bound-variable limit.
 */
export function existingAssetIds(db: AppDatabase, ids: string[], chunkSize = 400): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const rows = db.all(
      sql`SELECT id FROM local_asset WHERE id IN (${sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `
      )})`
    ) as { id: string }[];
    for (const r of rows) out.add(r.id);
  }
  return out;
}

/** Membership index (asset_id → modified_at) for one album, for the full diff. */
export function albumAssetIndex(db: AppDatabase, albumId: string): Map<string, number> {
  const rows = db.all(
    sql`SELECT la.id AS id, la.modified_at AS modified_at
        FROM local_album_asset laa JOIN local_asset la ON la.id = laa.asset_id
        WHERE laa.album_id = ${albumId}`
  ) as { id: string; modified_at: number | null }[];
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.id, r.modified_at ?? 0);
  return out;
}

/** Current membership count for an album (our DB's view). */
export function albumMembershipCount(db: AppDatabase, albumId: string): number {
  const row = db.get(
    sql`SELECT COUNT(*) AS c FROM local_album_asset WHERE album_id = ${albumId}`
  ) as { c: number } | undefined;
  return row?.c ?? 0;
}

export type LocalAlbumRow = {
  id: string;
  title: string | null;
  asset_count: number | null;
  modified_at: number | null;
  backup_selection: number;
};

export function getLocalAlbum(db: AppDatabase, id: string): LocalAlbumRow | null {
  const row = db.get(
    sql`SELECT id, title, asset_count, modified_at, backup_selection FROM local_album WHERE id = ${id}`
  ) as LocalAlbumRow | undefined;
  return row ?? null;
}

/**
 * Delete assets that no longer belong to ANY album — device-wide deletions
 * surface here after every album's membership has been reconciled (doc 03 §4).
 * Cascades to membership + any queued upload rows. Returns the deleted ids.
 */
export function sweepOrphanAssets(db: AppDatabase): string[] {
  const orphans = db.all(
    sql`SELECT id FROM local_asset la
        WHERE NOT EXISTS (SELECT 1 FROM local_album_asset laa WHERE laa.asset_id = la.id)`
  ) as { id: string }[];
  const ids = orphans.map((o) => o.id);
  if (ids.length === 0) return ids;
  db.transaction((tx) => {
    for (const id of ids) {
      tx.run(sql`DELETE FROM local_asset WHERE id = ${id}`);
      tx.run(sql`DELETE FROM local_album_asset WHERE asset_id = ${id}`);
      tx.run(sql`DELETE FROM upload_queue WHERE asset_id = ${id}`);
    }
  });
  return ids;
}

/* ---- per-album fast-path watermark (app_meta) ------------------------- */

const watermarkKey = (albumId: string) => `media_watermark:${albumId}`;

/** Last-synced max creationTime for an album (fast-path `createdAfter`). */
export function getAlbumWatermark(db: AppDatabase, albumId: string): number | null {
  const row = db.get(
    sql`SELECT value FROM app_meta WHERE key = ${watermarkKey(albumId)}`
  ) as { value: string | null } | undefined;
  if (row?.value == null) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

export function setAlbumWatermark(db: AppDatabase, albumId: string, value: number, now = Date.now()): void {
  db.run(
    sql`INSERT INTO app_meta (key, value, updated_at) VALUES (${watermarkKey(albumId)}, ${String(value)}, ${now})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
}

const MEDIA_ACCESS_KEY = "media_access";

/** Persist the last-seen media access level (all | limited | none) for the UI. */
export function setMediaAccess(db: AppDatabase, access: string, now = Date.now()): void {
  db.run(
    sql`INSERT INTO app_meta (key, value, updated_at) VALUES (${MEDIA_ACCESS_KEY}, ${access}, ${now})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
}

export function getMediaAccess(db: AppDatabase): "all" | "limited" | "none" | null {
  const row = db.get(sql`SELECT value FROM app_meta WHERE key = ${MEDIA_ACCESS_KEY}`) as
    | { value: string | null }
    | undefined;
  const v = row?.value;
  return v === "all" || v === "limited" || v === "none" ? v : null;
}
