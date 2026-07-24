/**
 * Local mirror row counts, keyed to match the server `/api/sync/counts/`
 * response (doc 03 §8). Used by the post-sync integrity check: a mismatch
 * beyond tolerance schedules a reseed.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";

/** Shape mirrors the server counts payload (minus server_time). */
export type LocalCounts = {
  photos: number;
  persons: number;
  user_albums: number;
  auto_albums: number;
  thing_albums: number;
  place_albums: number;
  tags: number;
};

function count(db: AppDatabase, table: string): number {
  const row = db.get(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`)) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function localCounts(db: AppDatabase): LocalCounts {
  return {
    photos: count(db, "remote_photo"),
    persons: count(db, "person"),
    user_albums: count(db, "user_album"),
    auto_albums: count(db, "auto_album"),
    thing_albums: count(db, "thing_album"),
    place_albums: count(db, "place_album"),
    tags: count(db, "tag_album"),
  };
}
