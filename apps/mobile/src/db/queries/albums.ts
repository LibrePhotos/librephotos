/**
 * Album read queries over the mirror: user (My Albums) and auto (Events) album
 * lists plus their photo membership joined back to remote_photo for grid tiles.
 * Thing/place/tag list rows are returned as-is (membership is fetched on tap,
 * doc 02 §1).
 */
import { sql } from "drizzle-orm";
import { isArray, parseJson } from "@/lib/guards";
import type { UserAlbumSort } from "@/lib/albumSort";
import type { AppDatabase } from "../types";
import type { PhotoTileRow } from "./filters";

export type UserAlbumRow = {
  id: number;
  title: string;
  owner_id: number | null;
  shared: number;
  favorited: number;
  cover_hash: string | null;
  photo_count: number;
  created_on: number | null;
  last_modified: number | null;
};

export type AutoAlbumRow = {
  id: number;
  title: string;
  timestamp: number | null;
  favorited: number;
  photo_count: number;
  cover_hash: string | null;
  last_modified: number | null;
};

const TILE_COLS = sql`rp.id, rp.image_hash, rp.timestamp, rp.added_on, rp.type, rp.aspect_ratio, rp.is_favorite, rp.dominant_color, rp.bucket_day`;

/**
 * The cover a user album shows: its explicit cover, else (like the web's
 * automatic cover) one of its photos — the newest one the album detail shows,
 * so never a hidden, trashed or removed photo. Null for an empty album.
 */
const USER_ALBUM_COVER = sql`COALESCE(ua.cover_hash, (
    SELECT rp.image_hash FROM user_album_photo uap JOIN remote_photo rp ON rp.id = uap.photo_id
    WHERE uap.album_id = ua.id AND rp.hidden = 0 AND rp.in_trashcan = 0 AND rp.removed = 0
    ORDER BY rp.timestamp DESC, rp.id DESC LIMIT 1))`;

const USER_ALBUM_ORDER: Record<UserAlbumSort, ReturnType<typeof sql>> = {
  name: sql`ua.title COLLATE NOCASE ASC, ua.id ASC`,
  // NULL dates go last in either direction.
  created_desc: sql`ua.created_on IS NULL, ua.created_on DESC, ua.title COLLATE NOCASE ASC`,
  created_asc: sql`ua.created_on IS NULL, ua.created_on ASC, ua.title COLLATE NOCASE ASC`,
  count_desc: sql`ua.photo_count DESC, ua.title COLLATE NOCASE ASC`,
  updated_desc: sql`ua.last_modified IS NULL, ua.last_modified DESC, ua.title COLLATE NOCASE ASC`,
};

/**
 * All user albums. Without a sort: favorites first then most-recent (the
 * Collections strip and the album picker); with one, that order alone (the My
 * Albums list's sort menu). `cover_hash` falls back to the newest photo.
 */
export function userAlbums(db: AppDatabase, sort?: UserAlbumSort): UserAlbumRow[] {
  const order = sort
    ? USER_ALBUM_ORDER[sort]
    : sql`ua.favorited DESC, ua.created_on DESC, ua.title ASC`;
  return db.all(
    sql`SELECT ua.id, ua.title, ua.owner_id, ua.shared, ua.favorited, ${USER_ALBUM_COVER} AS cover_hash,
               ua.photo_count, ua.created_on, ua.last_modified
        FROM user_album ua ORDER BY ${order}`
  ) as UserAlbumRow[];
}

/** One user album's explicit cover hash (null while it is automatic or unknown). */
export function userAlbumExplicitCover(db: AppDatabase, albumId: number): string | null {
  const row = db.get(sql`SELECT cover_hash FROM user_album WHERE id = ${albumId}`) as
    | { cover_hash: string | null }
    | undefined;
  return row?.cover_hash ?? null;
}

/** Photos in one user album, in the album's stored ordering (newest fallback). */
export function userAlbumPhotos(db: AppDatabase, albumId: number): PhotoTileRow[] {
  return db.all(
    sql`SELECT ${TILE_COLS}
        FROM user_album_photo uap JOIN remote_photo rp ON rp.id = uap.photo_id
        WHERE uap.album_id = ${albumId}
        ORDER BY uap.ordering ASC, rp.timestamp DESC`
  ) as PhotoTileRow[];
}

/** All auto (event) albums, newest event first. */
export function autoAlbums(db: AppDatabase): AutoAlbumRow[] {
  return db.all(
    sql`SELECT id, title, timestamp, favorited, photo_count, cover_hash, last_modified
        FROM auto_album ORDER BY timestamp DESC, id DESC`
  ) as AutoAlbumRow[];
}

/** Photos in one auto album. */
export function autoAlbumPhotos(db: AppDatabase, albumId: number): PhotoTileRow[] {
  return db.all(
    sql`SELECT ${TILE_COLS}
        FROM auto_album_photo aap JOIN remote_photo rp ON rp.id = aap.photo_id
        WHERE aap.album_id = ${albumId}
        ORDER BY aap.ordering ASC, rp.timestamp DESC`
  ) as PhotoTileRow[];
}

/* ---- thing / place / tag list mirrors (membership fetched on tap) ------- */

export type NamedAlbumRow = {
  id: number;
  title: string;
  cover_hashes: string | null;
  photo_count: number;
};

/** Parse the first cover hash out of the stored JSON array (or null). */
export function firstCoverHash(coverHashes: string | null): string | null {
  if (!coverHashes) return null;
  try {
    const arr = parseJson(coverHashes);
    if (isArray(arr) && typeof arr[0] === "string") return arr[0];
  } catch {
    // malformed — treat as no cover
  }
  return null;
}

function namedAlbums(db: AppDatabase, table: "thing_album" | "place_album" | "tag_album"): NamedAlbumRow[] {
  return db.all(
    sql.raw(
      `SELECT id, title, cover_hashes, photo_count FROM ${table} ORDER BY photo_count DESC, title ASC`
    )
  ) as NamedAlbumRow[];
}

export function thingAlbumsList(db: AppDatabase): NamedAlbumRow[] {
  return namedAlbums(db, "thing_album");
}

export function placeAlbumsList(db: AppDatabase): NamedAlbumRow[] {
  return namedAlbums(db, "place_album");
}

export function tagAlbumsList(db: AppDatabase): NamedAlbumRow[] {
  return namedAlbums(db, "tag_album");
}
