/**
 * "On this day" memories (doc 05 §Memories, P2). A pure mirror query: photos
 * whose bucket_day month-day matches a given day in a *prior* year, favorites
 * weighted to the front. No backend memories endpoint is required — it reads the
 * already-synced remote_photo rows, so it works fully offline. Node-tested.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";
import type { PhotoTileRow } from "./filters";
import { getMeta, setMeta } from "./app-meta";

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

/* ---- memories notification prefs (app_meta) ---------------------------- */

const NOTIF_ENABLED = "memories_notif_enabled";
const NOTIF_TIME = "memories_notif_time"; // "HH:MM"

export type MemoriesNotifPrefs = { enabled: boolean; hour: number; minute: number };

/** Clamp+parse a "HH:MM" string into {hour, minute}; defaults to 09:00. */
export function parseTime(value: string | null): { hour: number; minute: number } {
  const m = value?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: 9, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));
  return { hour, minute };
}

/** Format {hour, minute} as a zero-padded "HH:MM". */
export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function getMemoriesNotifPrefs(db: AppDatabase): MemoriesNotifPrefs {
  const { hour, minute } = parseTime(getMeta(db, NOTIF_TIME));
  return { enabled: getMeta(db, NOTIF_ENABLED) === "1", hour, minute };
}

export function setMemoriesNotifPrefs(
  db: AppDatabase,
  patch: Partial<MemoriesNotifPrefs>,
  now = Date.now()
): void {
  if (patch.enabled !== undefined) setMeta(db, NOTIF_ENABLED, patch.enabled ? "1" : "0", now);
  if (patch.hour !== undefined || patch.minute !== undefined) {
    const cur = getMemoriesNotifPrefs(db);
    setMeta(db, NOTIF_TIME, formatTime(patch.hour ?? cur.hour, patch.minute ?? cur.minute), now);
  }
}
