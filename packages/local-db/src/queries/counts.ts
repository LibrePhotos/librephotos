import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";

export type LocalCounts = {
  photos: number;
  persons: number;
  user_albums: number;
  auto_albums: number;
  thing_albums: number;
  place_albums: number;
  tags: number;
};

async function count(db: AppDatabase, table: string): Promise<number> {
  const row = await db.get<{ c: number } | undefined>(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`));
  return row?.c ?? 0;
}

export async function localCounts(db: AppDatabase): Promise<LocalCounts> {
  return {
    photos: await count(db, "remote_photo"),
    persons: await count(db, "person"),
    user_albums: await count(db, "user_album"),
    auto_albums: await count(db, "auto_album"),
    thing_albums: await count(db, "thing_album"),
    place_albums: await count(db, "place_album"),
    tags: await count(db, "tag_album"),
  };
}

export const EMPTY_LOCAL_COUNTS: LocalCounts = Object.freeze({
  photos: 0,
  persons: 0,
  user_albums: 0,
  auto_albums: 0,
  thing_albums: 0,
  place_albums: 0,
  tags: 0,
});

export type LibraryStats = {
  photos: number;
  videos: number;
  people: number;
  albums: number;
  places: number;
  things: number;
  favorites: number;
};

async function scalar(db: AppDatabase, query: string): Promise<number> {
  const row = await db.get<{ c: number } | undefined>(sql.raw(query));
  return row?.c ?? 0;
}

export async function libraryStats(db: AppDatabase): Promise<LibraryStats> {
  const visible = "removed = 0 AND in_trashcan = 0";
  return {
    photos: await scalar(db, `SELECT COUNT(*) AS c FROM remote_photo WHERE type != 'video' AND ${visible}`),
    videos: await scalar(db, `SELECT COUNT(*) AS c FROM remote_photo WHERE type = 'video' AND ${visible}`),
    people: await scalar(db, `SELECT COUNT(*) AS c FROM person WHERE COALESCE(face_count, 0) > 0`),
    albums: await count(db, "user_album"),
    places: await count(db, "place_album"),
    things: await count(db, "thing_album"),
    favorites: await scalar(db, `SELECT COUNT(*) AS c FROM remote_photo WHERE is_favorite = 1 AND hidden = 0 AND ${visible}`),
  };
}

export const EMPTY_LIBRARY_STATS: LibraryStats = Object.freeze({
  photos: 0,
  videos: 0,
  people: 0,
  albums: 0,
  places: 0,
  things: 0,
  favorites: 0,
});
