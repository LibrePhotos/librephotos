/**
 * Flag-filter screens over the remote mirror: favorites, hidden, deleted (trash),
 * videos, recent, and no-timestamp. Each is a small predicate against
 * remote_photo, ordered newest-first and keyset-paginated. Favorites/hidden/trash
 * ride their partial indexes (doc 02 §1); recent orders by added_on.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "../types";

export type PhotoTileRow = {
  id: string;
  image_hash: string;
  timestamp: number | null;
  added_on: number;
  type: string;
  aspect_ratio: number | null;
  is_favorite: number;
  dominant_color: string | null;
  bucket_day: string;
};

const COLS = sql`id, image_hash, timestamp, added_on, type, aspect_ratio, is_favorite, dominant_color, bucket_day`;

export type PhotoFilter =
  | "favorites"
  | "hidden"
  | "deleted"
  | "videos"
  | "recent"
  | "notimestamp";

/** The WHERE predicate + ORDER BY column for each filter. */
function spec(filter: PhotoFilter): { where: SQL; orderBy: SQL } {
  switch (filter) {
    case "favorites":
      return {
        where: sql`is_favorite = 1 AND hidden = 0 AND in_trashcan = 0 AND removed = 0 AND timestamp IS NOT NULL`,
        orderBy: sql`timestamp DESC, id DESC`,
      };
    case "hidden":
      return {
        where: sql`hidden = 1 AND removed = 0`,
        orderBy: sql`timestamp DESC, id DESC`,
      };
    case "deleted":
      return {
        where: sql`in_trashcan = 1 AND removed = 0`,
        orderBy: sql`timestamp DESC, id DESC`,
      };
    case "videos":
      return {
        where: sql`type = 'video' AND hidden = 0 AND in_trashcan = 0 AND removed = 0`,
        orderBy: sql`timestamp DESC, id DESC`,
      };
    case "recent":
      return {
        where: sql`hidden = 0 AND in_trashcan = 0 AND removed = 0`,
        orderBy: sql`added_on DESC, id DESC`,
      };
    case "notimestamp":
      return {
        where: sql`timestamp IS NULL AND hidden = 0 AND in_trashcan = 0 AND removed = 0`,
        orderBy: sql`added_on DESC, id DESC`,
      };
  }
}

/** All rows matching a flag filter, newest-first (optionally limited). */
export function filterPhotos(
  db: AppDatabase,
  filter: PhotoFilter,
  opts: { limit?: number } = {}
): PhotoTileRow[] {
  const { where, orderBy } = spec(filter);
  const limit = opts.limit ? sql`LIMIT ${opts.limit}` : sql``;
  return db.all(
    sql`SELECT ${COLS} FROM remote_photo WHERE ${where} ORDER BY ${orderBy} ${limit}`
  ) as PhotoTileRow[];
}

/** EXPLAIN QUERY PLAN for a flag filter (test-only budget assertions). */
export function explainFilter(db: AppDatabase, filter: PhotoFilter): { detail: string }[] {
  const { where, orderBy } = spec(filter);
  return db.all(
    sql`EXPLAIN QUERY PLAN SELECT ${COLS} FROM remote_photo WHERE ${where} ORDER BY ${orderBy} LIMIT 200`
  ) as { detail: string }[];
}
