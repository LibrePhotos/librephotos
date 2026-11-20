import { sql, type SQL } from "drizzle-orm";
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
import {
  deleteAutoAlbumsSql,
  deleteNamedAlbumsSql,
  deletePersonsSql,
  deleteRemotePhotosSql,
  deleteSharedUsersSql,
  deleteUserAlbumsSql,
  runBatch,
  settleUploadsSql,
  upsertAutoAlbumsSql,
  upsertNamedAlbumsSql,
  upsertPersonsSql,
  upsertPlaceAlbumsSql,
  upsertRemotePhotosSql,
  upsertSharedUsersSql,
  upsertUserAlbumsSql,
  type AppDatabase,
  type SyncEntity,
} from "@librephotos/local-db";
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
function advanceCursorSql(entity: SyncEntity, nextCursor: string | null, cursorModified: number | null): SQL[] {
  if (nextCursor == null) return [];
  return [
    sql`UPDATE sync_state SET cursor_id = ${nextCursor}, cursor_modified = ${cursorModified}
        WHERE entity = ${entity}`,
  ];
}

function lastModifiedOf(items: { last_modified?: number | null }[]): number | null {
  if (items.length === 0) return null;
  return items[items.length - 1]?.last_modified ?? null;
}

async function applyPage(
  db: AppDatabase,
  entity: SyncEntity,
  env: PageEnvelope<{ last_modified?: number | null }>,
  writes: SQL[],
  deletes: SQL[]
): Promise<ApplyResult> {
  await runBatch(db, [...writes, ...deletes, ...advanceCursorSql(entity, env.next_cursor, lastModifiedOf(env.items))]);
  return { applied: env.items.length, deleted: env.tombstones.length };
}

export function applyPhotosPage(db: AppDatabase, env: SyncPhotosResponse, now: number): Promise<ApplyResult> {
  const rows = env.items.map((i) => syncPhotoToRow(i, now));
  return applyPage(
    db,
    "photo",
    env,
    // Uploads whose photo this page brought in with a thumbnail are no longer
    // "processing on the server" (#2740).
    [...upsertRemotePhotosSql(rows), settleUploadsSql(now)],
    deleteRemotePhotosSql(env.tombstones)
  );
}

export function applyPersonsPage(db: AppDatabase, env: SyncPersonsResponse, _now: number): Promise<ApplyResult> {
  return applyPage(
    db,
    "person",
    env,
    upsertPersonsSql(env.items.map(syncPersonToRow)),
    deletePersonsSql(env.tombstones.map(Number))
  );
}

export function applyUserAlbumsPage(db: AppDatabase, env: SyncUserAlbumsResponse, _now: number): Promise<ApplyResult> {
  return applyPage(
    db,
    "user_album",
    env,
    upsertUserAlbumsSql(env.items.map(syncUserAlbumToRow)),
    deleteUserAlbumsSql(env.tombstones.map(Number))
  );
}

export function applyAutoAlbumsPage(db: AppDatabase, env: SyncAutoAlbumsResponse, _now: number): Promise<ApplyResult> {
  return applyPage(
    db,
    "auto_album",
    env,
    upsertAutoAlbumsSql(env.items.map(syncAutoAlbumToRow)),
    deleteAutoAlbumsSql(env.tombstones.map(Number))
  );
}

export function applyThingAlbumsPage(db: AppDatabase, env: SyncThingAlbumsResponse, _now: number): Promise<ApplyResult> {
  return applyPage(
    db,
    "thing_album",
    env,
    upsertNamedAlbumsSql("thing_album", env.items.map(syncNamedAlbumToRow)),
    deleteNamedAlbumsSql("thing_album", env.tombstones.map(Number))
  );
}

export function applyTagAlbumsPage(db: AppDatabase, env: SyncTagAlbumsResponse, _now: number): Promise<ApplyResult> {
  return applyPage(
    db,
    "tag_album",
    env,
    upsertNamedAlbumsSql("tag_album", env.items.map(syncNamedAlbumToRow)),
    deleteNamedAlbumsSql("tag_album", env.tombstones.map(Number))
  );
}

export function applyPlaceAlbumsPage(db: AppDatabase, env: SyncPlaceAlbumsResponse, _now: number): Promise<ApplyResult> {
  return applyPage(
    db,
    "place_album",
    env,
    upsertPlaceAlbumsSql(env.items.map(syncPlaceAlbumToRow)),
    deleteNamedAlbumsSql("place_album", env.tombstones.map(Number))
  );
}

export function applySharingPage(db: AppDatabase, env: SyncSharingResponse, _now: number): Promise<ApplyResult> {
  return applyPage(
    db,
    "sharing",
    env,
    upsertSharedUsersSql(env.items.map(syncSharedUserToRow)),
    deleteSharedUsersSql(env.tombstones.map(Number))
  );
}
