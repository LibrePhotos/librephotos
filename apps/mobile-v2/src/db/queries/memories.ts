/**
 * "On this day" memories (doc 05 §Memories, P2). A pure mirror query: photos
 * whose bucket_day month-day matches a given day in a *prior* year, favorites
 * weighted to the front. No backend memories endpoint is required — it reads the
 * already-synced remote_photo rows, so it works fully offline. Node-tested.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";
import type { PhotoTileRow } from "./filters";

const PHOTO_COLS = sql`id, image_hash, timestamp, added_on, type, aspect_ratio, is_favorite, dominant_color, bucket_day`;

/** Local month-day ("MM-DD") for a given date (defaults to today). */
export function monthDayOf(date: Date = new Date()): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export type MemoryPhoto = PhotoTileRow & { year: number };

/**
 * Photos taken on this month-day in earlier years, favorites first. `today` is
 * injectable for tests. Excludes hidden/trashed and the current year.
 */
export function onThisDay(
  db: AppDatabase,
  opts: { today?: Date; limit?: number } = {}
): MemoryPhoto[] {
  const today = opts.today ?? new Date();
  const monthDay = monthDayOf(today);
  const currentYear = today.getFullYear();
  const limit = opts.limit ?? 60;

  return db.all(
    sql`SELECT ${PHOTO_COLS}, CAST(substr(bucket_day, 1, 4) AS INTEGER) AS year
        FROM remote_photo
        WHERE hidden = 0 AND in_trashcan = 0 AND removed = 0
          AND timestamp IS NOT NULL
          AND substr(bucket_day, 6, 5) = ${monthDay}
          AND CAST(substr(bucket_day, 1, 4) AS INTEGER) < ${currentYear}
        ORDER BY is_favorite DESC, timestamp DESC, id DESC
        LIMIT ${limit}`
  ) as MemoryPhoto[];
}

/** Distinct prior years that have a memory on this day (newest first). */
export function memoryYears(db: AppDatabase, opts: { today?: Date } = {}): number[] {
  const memories = onThisDay(db, { ...opts, limit: 1000 });
  return [...new Set(memories.map((m) => m.year))].sort((a, b) => b - a);
}
