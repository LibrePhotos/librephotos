/**
 * Backup settings + album-selection reads (doc 03 §3/§5). Global toggles
 * (enabled / wifi-only / charging-only) persist in `app_meta`; per-album backup
 * selection lives on `local_album.backup_selection` (0 none | 1 selected |
 * 2 excluded). All persisted in the mirror DB, so they survive restarts and are
 * read by both the Backup screen (live queries) and the pure upload engine.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";
import { getMeta, setMeta } from "./app-meta";

export const META_BACKUP_ENABLED = "backup_enabled";
export const META_BACKUP_WIFI_ONLY = "backup_wifi_only";
export const META_BACKUP_CHARGING_ONLY = "backup_charging_only";

export type BackupConfig = {
  enabled: boolean;
  wifiOnly: boolean;
  chargingOnly: boolean;
};

async function flag(db: AppDatabase, key: string, dflt: boolean): Promise<boolean> {
  const raw = await getMeta(db, key);
  if (raw == null) return dflt;
  return raw === "1" || raw === "true";
}

/** What getBackupConfig answers for a database that has no settings yet. */
export const DEFAULT_BACKUP_CONFIG: BackupConfig = Object.freeze({ enabled: false, wifiOnly: true, chargingOnly: false });

export async function getBackupConfig(db: AppDatabase): Promise<BackupConfig> {
  return {
    // Backup is opt-in; wifi-only defaults on (safe default), charging-only off.
    enabled: await flag(db, META_BACKUP_ENABLED, false),
    wifiOnly: await flag(db, META_BACKUP_WIFI_ONLY, true),
    chargingOnly: await flag(db, META_BACKUP_CHARGING_ONLY, false),
  };
}

export async function setBackupConfig(db: AppDatabase, patch: Partial<BackupConfig>, now = Date.now()): Promise<void> {
  if (patch.enabled !== undefined) await setMeta(db, META_BACKUP_ENABLED, patch.enabled ? "1" : "0", now);
  if (patch.wifiOnly !== undefined) await setMeta(db, META_BACKUP_WIFI_ONLY, patch.wifiOnly ? "1" : "0", now);
  if (patch.chargingOnly !== undefined)
    await setMeta(db, META_BACKUP_CHARGING_ONLY, patch.chargingOnly ? "1" : "0", now);
}

export type AlbumBackupRow = {
  id: string;
  title: string | null;
  /** Device-reported asset count. */
  asset_count: number | null;
  backup_selection: number;
  /** Assets we've linked for this album. */
  linked: number;
  /** Linked + hashed (upload-ready). */
  hashed: number;
  /** Linked assets already present on the server (by hash). */
  on_server: number;
};

/**
 * Albums with backup-relevant counts for the selection list. Ordered
 * selected-first, then by size.
 */
export async function listBackupAlbums(db: AppDatabase): Promise<AlbumBackupRow[]> {
  return await db.all<AlbumBackupRow>(
    sql`SELECT l.id AS id, l.title AS title, l.asset_count AS asset_count, l.backup_selection AS backup_selection,
               COUNT(laa.asset_id) AS linked,
               SUM(CASE WHEN la.hash IS NOT NULL AND la.hash <> '' THEN 1 ELSE 0 END) AS hashed,
               SUM(CASE WHEN la.hash IS NOT NULL AND EXISTS
                     (SELECT 1 FROM remote_photo rp WHERE rp.image_hash = la.hash) THEN 1 ELSE 0 END) AS on_server
        FROM local_album l
        LEFT JOIN local_album_asset laa ON laa.album_id = l.id
        LEFT JOIN local_asset la ON la.id = laa.asset_id
        GROUP BY l.id
        ORDER BY (CASE l.backup_selection WHEN 1 THEN 0 WHEN 2 THEN 2 ELSE 1 END) ASC, linked DESC`
  );
}

/** Set an album's backup selection (0 none | 1 selected | 2 excluded). */
export async function setAlbumBackupSelection(db: AppDatabase, albumId: string, selection: 0 | 1 | 2): Promise<void> {
  await db.run(sql`UPDATE local_album SET backup_selection = ${selection} WHERE id = ${albumId}`);
}

/** Cycle a selection none → selected → excluded → none (Backup tab tap). */
export function cycleAlbumSelection(current: number): 0 | 1 | 2 {
  if (current === 0) return 1;
  if (current === 1) return 2;
  return 0;
}
