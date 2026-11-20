/**
 * Mirror writers: upsert server rows into the remote mirror. Upserts are
 * idempotent (ON CONFLICT DO UPDATE keyed on the server id) so a re-seed or a
 * pull-to-refresh converges without duplicates.
 *
 * Two layers:
 *
 * - `*Sql(rows)` builds the statements and runs nothing. A caller that must
 *   write several things atomically (the delta applier: one sync page = rows +
 *   tombstones + cursor) concatenates them and runs them as ONE batch with
 *   {@link runBatch}.
 * - `upsert*(db, rows)` / `delete*(db, ids)` run them, each chunk of
 *   ≤{@link BATCH_SIZE} rows as its own batch, so a seed of 100k photos never
 *   holds one giant transaction and live queries see progress (doc 02 §5).
 *
 * Mapping API responses onto these inputs is the app's job (the package does
 * not depend on the API client).
 */
import { sql, type SQL } from "drizzle-orm";
import { runBatch } from "./batch";
import type { AppDatabase } from "./types";

export const BATCH_SIZE = 1000;

export type RemotePhotoInput = {
  id: string;
  imageHash: string;
  ownerId: number;
  timestamp: number | null;
  addedOn: number;
  lastModified: number;
  type: string;
  videoLengthMs: number | null;
  rating: number;
  isFavorite: boolean;
  hidden: boolean;
  /** Off the timeline and Memories (#545). */
  archived: boolean;
  isScreenshot: boolean;
  isDocument: boolean;
  inTrashcan: boolean;
  removed: boolean;
  isPublic: boolean;
  aspectRatio: number | null;
  latitude: number | null;
  longitude: number | null;
  searchLocation: string | null;
  dominantColor: string | null;
  bucketDay: string;
  bucketMonth: string;
};

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const b = (v: boolean) => (v ? 1 : 0);

/** A parameterised `?, ?, ...` list. */
export function inList(values: readonly (string | number)[]): SQL {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  );
}

/** Run `build(chunk)` per chunk of rows, each chunk as one batch. Returns rows written. */
async function chunked<T>(db: AppDatabase, rows: readonly T[], build: (batch: T[]) => SQL[]): Promise<number> {
  for (const batch of chunk(rows, BATCH_SIZE)) await runBatch(db, build(batch));
  return rows.length;
}

/* ---- remote photos ------------------------------------------------------ */

export function upsertRemotePhotosSql(rows: readonly RemotePhotoInput[]): SQL[] {
  return rows.map(
    (r) =>
      sql`INSERT INTO remote_photo
        (id, image_hash, owner_id, timestamp, added_on, last_modified, type, video_length_ms,
         rating, is_favorite, hidden, archived, is_screenshot, is_document, in_trashcan, removed,
         is_public, aspect_ratio, latitude, longitude, search_location, dominant_color, bucket_day,
         bucket_month)
        VALUES (${r.id}, ${r.imageHash}, ${r.ownerId}, ${r.timestamp}, ${r.addedOn}, ${r.lastModified},
         ${r.type}, ${r.videoLengthMs}, ${r.rating}, ${b(r.isFavorite)}, ${b(r.hidden)}, ${b(r.archived)},
         ${b(r.isScreenshot)}, ${b(r.isDocument)}, ${b(r.inTrashcan)},
         ${b(r.removed)}, ${b(r.isPublic)}, ${r.aspectRatio}, ${r.latitude}, ${r.longitude},
         ${r.searchLocation}, ${r.dominantColor}, ${r.bucketDay}, ${r.bucketMonth})
        ON CONFLICT(id) DO UPDATE SET
          image_hash = excluded.image_hash, owner_id = excluded.owner_id, timestamp = excluded.timestamp,
          added_on = excluded.added_on, last_modified = excluded.last_modified, type = excluded.type,
          video_length_ms = excluded.video_length_ms, rating = excluded.rating,
          is_favorite = excluded.is_favorite, hidden = excluded.hidden, archived = excluded.archived,
          is_screenshot = excluded.is_screenshot, is_document = excluded.is_document,
          in_trashcan = excluded.in_trashcan,
          removed = excluded.removed, is_public = excluded.is_public, aspect_ratio = excluded.aspect_ratio,
          latitude = excluded.latitude, longitude = excluded.longitude,
          search_location = excluded.search_location, dominant_color = excluded.dominant_color,
          bucket_day = excluded.bucket_day, bucket_month = excluded.bucket_month`
  );
}

/** Delete remote photos (and their detail cache) by id — tombstone application. */
export function deleteRemotePhotosSql(ids: readonly string[]): SQL[] {
  if (ids.length === 0) return [];
  return chunk(ids, BATCH_SIZE).flatMap((batch) => [
    sql`DELETE FROM remote_photo WHERE id IN (${inList(batch)})`,
    sql`DELETE FROM remote_photo_detail WHERE photo_id IN (${inList(batch)})`,
  ]);
}

/** Idempotent batched upsert of remote photos. Returns rows written. */
export function upsertRemotePhotos(db: AppDatabase, rows: readonly RemotePhotoInput[]): Promise<number> {
  return chunked(db, rows, upsertRemotePhotosSql);
}

export async function deleteRemotePhotos(db: AppDatabase, ids: readonly string[]): Promise<void> {
  await runBatch(db, deleteRemotePhotosSql(ids));
}

/**
 * Drop the owner's photos with these image hashes from the mirror (and their
 * detail cache), after the server deleted them for good. The server deletes
 * every row of the requester's that carries the hash (image_hash is not unique),
 * and only theirs, so this matches it: another user's shared photo with the same
 * hash stays. The next delta pull brings the same tombstones; removing the rows
 * now just spares the grid a stale moment. Returns how many rows went.
 *
 * Each statement selects by owner + hash itself, so the batch is atomic without
 * reading the ids first.
 */
export async function deleteOwnedRemotePhotosByHash(
  db: AppDatabase,
  ownerId: number,
  imageHashes: readonly string[]
): Promise<number> {
  if (imageHashes.length === 0) return 0;
  let deleted = 0;
  for (const batch of chunk(imageHashes, BATCH_SIZE)) {
    const owned = sql`SELECT id FROM remote_photo WHERE owner_id = ${ownerId} AND image_hash IN (${inList(batch)})`;
    const [, removed] = await db.batch([
      db.run(sql`DELETE FROM remote_photo_detail WHERE photo_id IN (${owned})`),
      db.all<{ id: string }>(
        sql`DELETE FROM remote_photo WHERE owner_id = ${ownerId} AND image_hash IN (${inList(batch)}) RETURNING id`
      ),
    ]);
    deleted += removed.length;
  }
  return deleted;
}

/* ---- persons ------------------------------------------------------------ */

export type PersonInput = {
  id: number;
  name: string | null;
  kind: string | null;
  faceCount: number | null;
  coverPhotoHash: string | null;
  lastModified: number | null;
};

export function upsertPersonsSql(rows: readonly PersonInput[]): SQL[] {
  return rows.map(
    (r) =>
      sql`INSERT INTO person (id, name, kind, face_count, cover_photo_hash, last_modified)
          VALUES (${r.id}, ${r.name}, ${r.kind}, ${r.faceCount}, ${r.coverPhotoHash}, ${r.lastModified})
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, kind = excluded.kind, face_count = excluded.face_count,
            cover_photo_hash = excluded.cover_photo_hash, last_modified = excluded.last_modified`
  );
}

export function deletePersonsSql(ids: readonly number[]): SQL[] {
  return ids.length === 0 ? [] : [sql`DELETE FROM person WHERE id IN (${inList(ids)})`];
}

export function upsertPersons(db: AppDatabase, rows: readonly PersonInput[]): Promise<number> {
  return chunked(db, rows, upsertPersonsSql);
}

export async function deletePersons(db: AppDatabase, ids: readonly number[]): Promise<void> {
  await runBatch(db, deletePersonsSql(ids));
}

/* ---- user albums -------------------------------------------------------- */

export type UserAlbumInput = {
  id: number;
  title: string;
  ownerId: number | null;
  shared: boolean;
  favorited: boolean;
  coverHash: string | null;
  photoCount: number;
  createdOn: number | null;
  lastModified: number | null;
  /** Ordered photo ids for membership (replaces existing membership). */
  photoIds?: string[];
};

/** Replace an album's ordered membership. */
function membershipSql(table: "user_album_photo" | "auto_album_photo", albumId: number, photoIds: readonly string[]): SQL[] {
  const tbl = sql.raw(table);
  return [
    sql`DELETE FROM ${tbl} WHERE album_id = ${albumId}`,
    ...photoIds.map(
      (photoId, ordering) =>
        sql`INSERT INTO ${tbl} (album_id, photo_id, ordering) VALUES (${albumId}, ${photoId}, ${ordering})
            ON CONFLICT(album_id, photo_id) DO UPDATE SET ordering = excluded.ordering`
    ),
  ];
}

export function upsertUserAlbumsSql(rows: readonly UserAlbumInput[]): SQL[] {
  return rows.flatMap((r) => [
    sql`INSERT INTO user_album
        (id, title, owner_id, shared, favorited, cover_hash, photo_count, created_on, last_modified)
        VALUES (${r.id}, ${r.title}, ${r.ownerId}, ${b(r.shared)}, ${b(r.favorited)}, ${r.coverHash},
          ${r.photoCount}, ${r.createdOn}, ${r.lastModified})
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title, owner_id = excluded.owner_id, shared = excluded.shared,
          favorited = excluded.favorited, cover_hash = excluded.cover_hash,
          photo_count = excluded.photo_count, created_on = excluded.created_on,
          last_modified = excluded.last_modified`,
    ...(r.photoIds ? membershipSql("user_album_photo", r.id, r.photoIds) : []),
  ]);
}

export function deleteUserAlbumsSql(ids: readonly number[]): SQL[] {
  if (ids.length === 0) return [];
  return [
    sql`DELETE FROM user_album WHERE id IN (${inList(ids)})`,
    sql`DELETE FROM user_album_photo WHERE album_id IN (${inList(ids)})`,
  ];
}

export function upsertUserAlbums(db: AppDatabase, rows: readonly UserAlbumInput[]): Promise<number> {
  return chunked(db, rows, upsertUserAlbumsSql);
}

/* ---- auto albums (events) ---------------------------------------------- */

export type AutoAlbumInput = {
  id: number;
  title: string;
  timestamp: number | null;
  favorited: boolean;
  photoCount: number;
  coverHash: string | null;
  lastModified: number | null;
  photoIds?: string[];
};

export function upsertAutoAlbumsSql(rows: readonly AutoAlbumInput[]): SQL[] {
  return rows.flatMap((r) => [
    sql`INSERT INTO auto_album (id, title, timestamp, favorited, photo_count, cover_hash, last_modified)
        VALUES (${r.id}, ${r.title}, ${r.timestamp}, ${b(r.favorited)}, ${r.photoCount}, ${r.coverHash}, ${r.lastModified})
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title, timestamp = excluded.timestamp, favorited = excluded.favorited,
          photo_count = excluded.photo_count, cover_hash = excluded.cover_hash,
          last_modified = excluded.last_modified`,
    ...(r.photoIds ? membershipSql("auto_album_photo", r.id, r.photoIds) : []),
  ]);
}

export function deleteAutoAlbumsSql(ids: readonly number[]): SQL[] {
  if (ids.length === 0) return [];
  return [
    sql`DELETE FROM auto_album WHERE id IN (${inList(ids)})`,
    sql`DELETE FROM auto_album_photo WHERE album_id IN (${inList(ids)})`,
  ];
}

export function upsertAutoAlbums(db: AppDatabase, rows: readonly AutoAlbumInput[]): Promise<number> {
  return chunked(db, rows, upsertAutoAlbumsSql);
}

/* ---- thing / tag / place albums (lists only) --------------------------- */

export type NamedAlbumInput = {
  id: number;
  title: string;
  photoCount: number;
  coverHashes: string[] | null;
  lastModified: number | null;
  geolocationLevel?: number | null;
};

export function upsertNamedAlbumsSql(table: "thing_album" | "tag_album", rows: readonly NamedAlbumInput[]): SQL[] {
  const tbl = sql.raw(table);
  return rows.map(
    (r) =>
      sql`INSERT INTO ${tbl} (id, title, photo_count, cover_hashes, last_modified)
          VALUES (${r.id}, ${r.title}, ${r.photoCount}, ${r.coverHashes ? JSON.stringify(r.coverHashes) : null}, ${r.lastModified})
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title, photo_count = excluded.photo_count,
            cover_hashes = excluded.cover_hashes, last_modified = excluded.last_modified`
  );
}

export function deleteNamedAlbumsSql(
  table: "thing_album" | "tag_album" | "place_album",
  ids: readonly number[]
): SQL[] {
  return ids.length === 0 ? [] : [sql`DELETE FROM ${sql.raw(table)} WHERE id IN (${inList(ids)})`];
}

export function upsertThingAlbums(db: AppDatabase, rows: readonly NamedAlbumInput[]): Promise<number> {
  return chunked(db, rows, (batch) => upsertNamedAlbumsSql("thing_album", batch));
}

export function upsertTagAlbums(db: AppDatabase, rows: readonly NamedAlbumInput[]): Promise<number> {
  return chunked(db, rows, (batch) => upsertNamedAlbumsSql("tag_album", batch));
}

export function upsertPlaceAlbumsSql(rows: readonly NamedAlbumInput[]): SQL[] {
  return rows.map(
    (r) =>
      sql`INSERT INTO place_album (id, title, photo_count, geolocation_level, cover_hashes, last_modified)
          VALUES (${r.id}, ${r.title}, ${r.photoCount}, ${r.geolocationLevel ?? null},
            ${r.coverHashes ? JSON.stringify(r.coverHashes) : null}, ${r.lastModified})
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title, photo_count = excluded.photo_count,
            geolocation_level = excluded.geolocation_level, cover_hashes = excluded.cover_hashes,
            last_modified = excluded.last_modified`
  );
}

export function upsertPlaceAlbums(db: AppDatabase, rows: readonly NamedAlbumInput[]): Promise<number> {
  return chunked(db, rows, upsertPlaceAlbumsSql);
}

/* ---- shared users (sharing surface) ------------------------------------ */

export type SharedUserInput = {
  id: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
};

export function upsertSharedUsersSql(rows: readonly SharedUserInput[]): SQL[] {
  return rows.map(
    (r) =>
      sql`INSERT INTO shared_user (id, username, first_name, last_name, avatar_url)
          VALUES (${r.id}, ${r.username}, ${r.firstName}, ${r.lastName}, ${r.avatarUrl})
          ON CONFLICT(id) DO UPDATE SET
            username = excluded.username, first_name = excluded.first_name,
            last_name = excluded.last_name, avatar_url = excluded.avatar_url`
  );
}

export function deleteSharedUsersSql(ids: readonly number[]): SQL[] {
  return ids.length === 0 ? [] : [sql`DELETE FROM shared_user WHERE id IN (${inList(ids)})`];
}

export function upsertSharedUsers(db: AppDatabase, rows: readonly SharedUserInput[]): Promise<number> {
  return chunked(db, rows, upsertSharedUsersSql);
}
