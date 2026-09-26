/**
 * Page applier: writes one delta page to the mirror in ONE transaction —
 * upsert items, delete tombstoned ids, advance the resume cursor (doc 03 §3).
 * Because the cursor is advanced inside the same transaction as the writes, a
 * crash mid-page leaves the cursor un-advanced and the page is simply re-fetched
 * and re-applied on the next run (idempotent by construction).
 */
import { sql } from "drizzle-orm";
import type {
  SyncAutoAlbumsResponse,
  SyncPersonsResponse,
  SyncPhotosResponse,
  SyncPlaceAlbumsResponse,
  SyncSharingResponse,
  SyncThingAlbumsResponse,
  SyncUserAlbumsResponse,
  SyncTagAlbumsResponse,
} from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import type { SyncEntity } from "@/db/queries/sync-state";
import {
  deleteAutoAlbums,
  deleteNamedAlbums,
  deletePersons,
  deleteRemotePhotos,
  deleteSharedUsers,
  deleteUserAlbums,
  writeAutoAlbums,
  writeNamedAlbums,
  writePersons,
  writePlaceAlbums,
  writeRemotePhotos,
  writeSharedUsers,
  writeUserAlbums,
} from "@/db/writers";
import {
  syncAutoAlbumToRow,
  syncNamedAlbumToRow,
  syncPersonToRow,
  syncPhotoToRow,
  syncPlaceAlbumToRow,
  syncSharedUserToRow,
  syncUserAlbumToRow,
} from "./mappers";

export type ApplyResult = { applied: number; deleted: number };

/** The structural subset of every sync envelope the loop/applier depend on. */
export type PageEnvelope<T> = {
  items: T[];
  tombstones: string[];
  next_cursor: string | null;
  total?: number;
};

/** Advance the durable resume cursor (only when the server gave us a token). */
function advanceCursor(
  tx: AppDatabase,
  entity: SyncEntity,
  nextCursor: string | null,
  cursorModified: number | null
): void {
  if (nextCursor == null) return;
  tx.run(
    sql`UPDATE sync_state SET cursor_id = ${nextCursor}, cursor_modified = ${cursorModified}
        WHERE entity = ${entity}`
  );
}

function lastModifiedOf(items: { last_modified?: number | null }[]): number | null {
  if (items.length === 0) return null;
  return items[items.length - 1]?.last_modified ?? null;
}

export function applyPhotosPage(db: AppDatabase, env: SyncPhotosResponse, now: number): ApplyResult {
  const rows = env.items.map((i) => syncPhotoToRow(i, now));
  db.transaction((tx) => {
    writeRemotePhotos(tx, rows);
    deleteRemotePhotos(tx, env.tombstones);
    advanceCursor(tx, "photo", env.next_cursor, lastModifiedOf(env.items));
  });
  return { applied: rows.length, deleted: env.tombstones.length };
}

export function applyPersonsPage(db: AppDatabase, env: SyncPersonsResponse, _now: number): ApplyResult {
  const rows = env.items.map(syncPersonToRow);
  db.transaction((tx) => {
    writePersons(tx, rows);
    deletePersons(tx, env.tombstones.map(Number));
    advanceCursor(tx, "person", env.next_cursor, lastModifiedOf(env.items));
  });
  return { applied: rows.length, deleted: env.tombstones.length };
}

export function applyUserAlbumsPage(db: AppDatabase, env: SyncUserAlbumsResponse, _now: number): ApplyResult {
  const rows = env.items.map(syncUserAlbumToRow);
  db.transaction((tx) => {
    writeUserAlbums(tx, rows);
    deleteUserAlbums(tx, env.tombstones.map(Number));
    advanceCursor(tx, "user_album", env.next_cursor, lastModifiedOf(env.items));
  });
  return { applied: rows.length, deleted: env.tombstones.length };
}

export function applyAutoAlbumsPage(db: AppDatabase, env: SyncAutoAlbumsResponse, _now: number): ApplyResult {
  const rows = env.items.map(syncAutoAlbumToRow);
  db.transaction((tx) => {
    writeAutoAlbums(tx, rows);
    deleteAutoAlbums(tx, env.tombstones.map(Number));
    advanceCursor(tx, "auto_album", env.next_cursor, lastModifiedOf(env.items));
  });
  return { applied: rows.length, deleted: env.tombstones.length };
}

export function applyThingAlbumsPage(db: AppDatabase, env: SyncThingAlbumsResponse, _now: number): ApplyResult {
  const rows = env.items.map(syncNamedAlbumToRow);
  db.transaction((tx) => {
    writeNamedAlbums(tx, "thing_album", rows);
    deleteNamedAlbums(tx, "thing_album", env.tombstones.map(Number));
    advanceCursor(tx, "thing_album", env.next_cursor, lastModifiedOf(env.items));
  });
  return { applied: rows.length, deleted: env.tombstones.length };
}

export function applyTagAlbumsPage(db: AppDatabase, env: SyncTagAlbumsResponse, _now: number): ApplyResult {
  const rows = env.items.map(syncNamedAlbumToRow);
  db.transaction((tx) => {
    writeNamedAlbums(tx, "tag_album", rows);
    deleteNamedAlbums(tx, "tag_album", env.tombstones.map(Number));
    advanceCursor(tx, "tag_album", env.next_cursor, lastModifiedOf(env.items));
  });
  return { applied: rows.length, deleted: env.tombstones.length };
}

export function applyPlaceAlbumsPage(db: AppDatabase, env: SyncPlaceAlbumsResponse, _now: number): ApplyResult {
  const rows = env.items.map(syncPlaceAlbumToRow);
  db.transaction((tx) => {
    writePlaceAlbums(tx, rows);
    deleteNamedAlbums(tx, "place_album", env.tombstones.map(Number));
    advanceCursor(tx, "place_album", env.next_cursor, lastModifiedOf(env.items));
  });
  return { applied: rows.length, deleted: env.tombstones.length };
}

export function applySharingPage(db: AppDatabase, env: SyncSharingResponse, _now: number): ApplyResult {
  const rows = env.items.map(syncSharedUserToRow);
  db.transaction((tx) => {
    writeSharedUsers(tx, rows);
    // Sharing has no DeletionLog tombstones (entity=None server-side); the set
    // is reconciled by a periodic reseed of this cheap feed.
    deleteSharedUsers(tx, env.tombstones.map(Number));
    advanceCursor(tx, "sharing", env.next_cursor, lastModifiedOf(env.items));
  });
  return { applied: rows.length, deleted: env.tombstones.length };
}
