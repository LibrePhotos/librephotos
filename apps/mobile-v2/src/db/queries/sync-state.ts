/**
 * sync_state accessors — one row per synced entity type, tracking the keyset
 * cursor (Phase 2 delta sync) and determinate seed progress for the UI.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";

export type SyncEntity =
  | "photo"
  | "person"
  | "user_album"
  | "auto_album"
  | "thing_album"
  | "place_album"
  | "tag_album";

export type SyncStateRow = {
  entity: string;
  cursor_modified: number | null;
  cursor_id: string | null;
  last_full_sync: number | null;
  status: string | null;
  progress_current: number;
  progress_total: number;
};

export function getSyncState(db: AppDatabase, entity: SyncEntity): SyncStateRow | null {
  const row = db.get(
    sql`SELECT entity, cursor_modified, cursor_id, last_full_sync, status, progress_current, progress_total
        FROM sync_state WHERE entity = ${entity}`
  ) as SyncStateRow | undefined;
  return row ?? null;
}

export function upsertSyncState(
  db: AppDatabase,
  entity: SyncEntity,
  patch: Partial<Omit<SyncStateRow, "entity">>
): void {
  db.run(
    sql`INSERT INTO sync_state (entity, cursor_modified, cursor_id, last_full_sync, status, progress_current, progress_total)
        VALUES (${entity}, ${patch.cursor_modified ?? null}, ${patch.cursor_id ?? null},
                ${patch.last_full_sync ?? null}, ${patch.status ?? "idle"},
                ${patch.progress_current ?? 0}, ${patch.progress_total ?? 0})
        ON CONFLICT(entity) DO UPDATE SET
          cursor_modified = COALESCE(excluded.cursor_modified, sync_state.cursor_modified),
          cursor_id       = COALESCE(excluded.cursor_id, sync_state.cursor_id),
          last_full_sync  = COALESCE(excluded.last_full_sync, sync_state.last_full_sync),
          status          = excluded.status,
          progress_current = excluded.progress_current,
          progress_total   = excluded.progress_total`
  );
}

/** All sync-state rows (drives the aggregate progress surface). */
export function allSyncState(db: AppDatabase): SyncStateRow[] {
  return db.all(
    sql`SELECT entity, cursor_modified, cursor_id, last_full_sync, status, progress_current, progress_total
        FROM sync_state`
  ) as SyncStateRow[];
}
