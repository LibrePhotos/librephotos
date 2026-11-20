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
 * The rows that are memories of `day`: taken on its month-day in an earlier
 * year, not hidden, trashed or archived, and no screenshot or document (the
 * web's Memories leave those out too: api/views/memories.py).
 */
function memoriesOf(day: Date) {
  return sql`hidden = 0 AND in_trashcan = 0 AND removed = 0 AND archived = 0
          AND is_screenshot = 0 AND is_document = 0
          AND timestamp IS NOT NULL
          AND substr(bucket_day, 6, 5) = ${monthDayOf(day)}
          AND CAST(substr(bucket_day, 1, 4) AS INTEGER) < ${day.getFullYear()}`;
}

/**
 * Photos taken on this month-day in earlier years, favorites first. `today` is
 * injectable for tests. Excludes hidden/trashed/archived, screenshots,
 * documents and the current year.
 */
export async function onThisDay(
  db: AppDatabase,
  opts: { today?: Date; limit?: number } = {}
): Promise<MemoryPhoto[]> {
  const today = opts.today ?? new Date();
  const limit = opts.limit ?? 60;

  return await db.all<MemoryPhoto>(
    sql`SELECT ${PHOTO_COLS}, CAST(substr(bucket_day, 1, 4) AS INTEGER) AS year
        FROM remote_photo
        WHERE ${memoriesOf(today)}
        ORDER BY is_favorite DESC, timestamp DESC, id DESC
        LIMIT ${limit}`
  );
}

/** Distinct prior years that have a memory on this day (newest first). */
export async function memoryYears(db: AppDatabase, opts: { today?: Date } = {}): Promise<number[]> {
  const memories = await onThisDay(db, { ...opts, limit: 1000 });
  return [...new Set(memories.map((m) => m.year))].sort((a, b) => b - a);
}

/** One day of `memoryDaysAhead`: local midnight, and its memories. */
export type MemoryDay = { day: Date; photoCount: number; yearCount: number };

/** Days `memoryDaysAhead` looks at by default: two weeks of reminders. */
export const MEMORY_DAYS_AHEAD = 14;

/**
 * For `today` and each of the `days - 1` days after it, how many memory photos
 * it has and from how many earlier years (the rules of `onThisDay`). Every day
 * is listed, those without memories with zero counts. Feb 29 only comes up in
 * a leap year, and a day in the new year counts the old one as earlier.
 */
export async function memoryDaysAhead(
  db: AppDatabase,
  opts: { today?: Date; days?: number } = {}
): Promise<MemoryDay[]> {
  const today = opts.today ?? new Date();
  const days = opts.days ?? MEMORY_DAYS_AHEAD;
  const out: MemoryDay[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const row = await db.get<{ photoCount: number; yearCount: number }>(
      sql`SELECT COUNT(*) AS photoCount, COUNT(DISTINCT substr(bucket_day, 1, 4)) AS yearCount
          FROM remote_photo
          WHERE ${memoriesOf(day)}`
    );
    out.push({ day, photoCount: row.photoCount, yearCount: row.yearCount });
  }
  return out;
}

/* ---- memories notification prefs (app_meta) ---------------------------- */

const NOTIF_ENABLED = "memories_notif_enabled";
const NOTIF_TIME = "memories_notif_time"; // "HH:MM"

export type MemoriesNotifPrefs = { enabled: boolean; hour: number; minute: number };

/** Clamp+parse a "HH:MM" string into {hour, minute}; defaults to 09:00. */
export const DEFAULT_MEMORIES_NOTIF_PREFS: MemoriesNotifPrefs = Object.freeze({ enabled: false, hour: 9, minute: 0 });

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

export async function getMemoriesNotifPrefs(db: AppDatabase): Promise<MemoriesNotifPrefs> {
  const { hour, minute } = parseTime(await getMeta(db, NOTIF_TIME));
  return { enabled: (await getMeta(db, NOTIF_ENABLED)) === "1", hour, minute };
}

export async function setMemoriesNotifPrefs(
  db: AppDatabase,
  patch: Partial<MemoriesNotifPrefs>,
  now = Date.now()
): Promise<void> {
  if (patch.enabled !== undefined) await setMeta(db, NOTIF_ENABLED, patch.enabled ? "1" : "0", now);
  if (patch.hour !== undefined || patch.minute !== undefined) {
    const cur = await getMemoriesNotifPrefs(db);
    await setMeta(db, NOTIF_TIME, formatTime(patch.hour ?? cur.hour, patch.minute ?? cur.minute), now);
  }
}
