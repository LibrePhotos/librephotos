// GET /api/memories (MemoriesView): one entry per earlier year with photos
// around today's date, nearest year first. Port of
// lp_api::timeline_photos::memories + lp_db::timeline_photos::memories
// (three queries: first date, the days in the windows, the window photo
// ids; plus one PigPhoto fetch).
import { sql, type SQL } from "drizzle-orm";
import { row, rows } from "~/lib/db";
import { pigByIds, type PigPhoto } from "~/lib/pig";
import type { QueryMap } from "~/lib/query";
import { photoFilters, type PhotoFilterParams } from "~/lib/scope";
import type { User } from "~/lib/users";
import { pyInt } from "./common";

const DEFAULT_WINDOW_DAYS = 3;
const MAX_WINDOW_DAYS = 30;
const DEFAULT_ITEMS = 30;
const MAX_ITEMS = 200;

/** A calendar date as days since 1970-01-01 (proleptic Gregorian, any year >= 1). */
type Day = number;
const DAY_MS = 86_400_000;

function mkDay(y: number, m: number, d: number): Day | null {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(dt.getTime() / DAY_MS);
}

function parts(day: Day): [number, number, number] {
  const dt = new Date(day * DAY_MS);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

function iso(day: Day): string {
  const [y, m, d] = parts(day);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ISO weekday 1 (Mon) .. 7 (Sun). */
const isoWeekday = (day: Day) => ((((day + 3) % 7) + 7) % 7) + 1;

function fromIsoWeek(year: number, week: number, weekday: number): Day | null {
  if (year < 1 || year > 9999) return null;
  const jan1 = mkDay(year, 1, 1)!;
  const leap = mkDay(year, 2, 29) !== null;
  const weeks = isoWeekday(jan1) === 4 || (leap && isoWeekday(jan1) === 3) ? 53 : 52;
  if (week < 1 || week > weeks) return null;
  const jan4 = mkDay(year, 1, 4)!;
  return jan4 - (isoWeekday(jan4) - 1) + (week - 1) * 7 + (weekday - 1);
}

/**
 * CPython 3.11+ date.fromisoformat: YYYY-MM-DD, YYYYMMDD and the ISO week
 * forms. Only lengths 7, 8 and 10 are tried; a tail after a complete date
 * is not checked (as CPython).
 */
export function pyDateFromIsoformat(s: string): Day | null {
  if (![7, 8, 10].includes(s.length) || /[^\x00-\x7f]/.test(s)) return null;
  const digits = (from: number, n: number): number | null => {
    const part = s.slice(from, from + n);
    return part.length === n && /^\d+$/.test(part) ? Number(part) : null;
  };
  const year = digits(0, 4);
  if (year === null) return null;
  const sep = s[4] === "-";
  let p = sep ? 5 : 4;
  if (s[p] === "W") {
    p += 1;
    const week = digits(p, 2);
    if (week === null) return null;
    p += 2;
    let day = 1;
    if (p < s.length) {
      if (sep) {
        if (s[p] !== "-") return null;
        p += 1;
      }
      const d = digits(p, 1);
      if (d === null) return null;
      day = d;
    }
    if (year === 0 || day < 1 || day > 7) return null;
    return fromIsoWeek(year, week, day);
  }
  const month = digits(p, 2);
  if (month === null) return null;
  p += 2;
  if (sep) {
    if (s[p] !== "-") return null;
    p += 1;
  }
  const day = digits(p, 2);
  if (day === null || year === 0) return null;
  return mkDay(year, month, day);
}

function todayFor(user: User): Day {
  let tz = user.defaultTimezone;
  let text: string;
  try {
    text = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    tz = "UTC";
    text = new Date().toISOString().slice(0, 10);
  }
  const [y, m, d] = text.split("-").map(Number);
  return mkDay(y, m, d)!;
}

function clampInt(v: string | undefined, def: number, min: number, max: number): number {
  const n = pyInt(v);
  return n === undefined ? def : Math.min(max, Math.max(min, n));
}

function parseFlag(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return !["false", "0", "f", "no", "off"].includes(v.trim().toLowerCase());
}

interface Window {
  yearsAgo: number;
  anchor: Day;
  start: Day;
  end: Day;
}

function anniversary(year: number, month: number, day: number): Day {
  return mkDay(year, month, day) ?? mkDay(year, month, day - 1) ?? 0;
}

function dayWindows(ref: Day, firstYear: number, windowDays: number): Window[] {
  const [ry, rm, rd] = parts(ref);
  const out: Window[] = [];
  for (let year = ry - 1; year >= firstYear; year--) {
    const anchor = anniversary(year, rm, rd);
    out.push({ yearsAgo: ry - year, anchor, start: anchor - windowDays, end: anchor + windowDays });
  }
  return out;
}

function monthWindows(ref: Day, firstYear: number): Window[] {
  const [ry, rm] = parts(ref);
  const out: Window[] = [];
  for (let year = ry - 1; year >= firstYear; year--) {
    const start = mkDay(year, rm, 1);
    if (start === null) continue;
    const end = rm === 12 ? mkDay(year, 12, 31) : mkDay(year, rm + 1, 1)! - 1;
    if (end === null) continue;
    out.push({ yearsAgo: ry - year, anchor: start, start, end });
  }
  return out;
}

const NO_FILTERS: PhotoFilterParams = {
  favorite: false,
  public: false,
  hidden: false,
  inTrashcan: false,
  video: false,
  photo: false,
  isScreenshot: false,
  isDocument: false,
  showAllStackPhotos: false,
};

/** memory_candidates: the timeline's own photos minus screenshots and documents. */
const candidates = (user: User) =>
  sql`${photoFilters("p", user.id, user.favoriteMinRating, NO_FILTERS)} AND NOT p.removed AND NOT p.is_screenshot AND NOT p.is_document`;

function inWindows(col: string, ws: { start: Day; end: Day }[]): SQL {
  if (!ws.length) return sql`1 = 0`;
  return sql`(${sql.join(
    ws.map((w) => sql`${sql.raw(col)} BETWEEN ${iso(w.start)}::date AND ${iso(w.end)}::date`),
    sql` OR `,
  )})`;
}

interface MemoryDay {
  date: string;
  place: string;
  total: number;
}

interface Memory {
  id: string;
  type: string;
  years_ago: number;
  year: number;
  date: string;
  start_date: string;
  end_date: string;
  location: string;
  numberOfItems: number;
  cover: PigPhoto;
  items: PigPhoto[];
}

async function build(user: User, windows: Window[], size: number, kind: string): Promise<Memory[]> {
  if (!windows.length) return [];
  const days = await rows<MemoryDay>(sql`SELECT d.date::text AS date,
      CASE WHEN jsonb_typeof(d.location->'places'->0) = 'string' THEN d.location->'places'->>0 ELSE '' END AS place,
      (SELECT count(DISTINCT p.id)::int FROM api_photo p
        JOIN api_albumdate_photos cap ON cap.photo_id = p.id
        JOIN api_albumdate cad ON cad.id = cap.albumdate_id
        WHERE cad.date = d.date AND ${candidates(user)}) AS total
    FROM api_albumdate d WHERE d.owner_id = ${user.id} AND d.date IS NOT NULL AND ${inWindows("d.date", windows)}
    ORDER BY d.date`);
  if (!days.length) return [];
  const places = new Map<string, string>();
  for (const d of days) if (d.place && !places.has(d.date)) places.set(d.date, d.place);

  const planned: { w: Window; dates: string[]; count: number }[] = [];
  for (const w of windows) {
    const s = iso(w.start);
    const e = iso(w.end);
    const inside = days.filter((d) => d.total > 0 && s <= d.date && d.date <= e);
    if (!inside.length) continue;
    const dates = inside.map((d) => d.date).sort();
    planned.push({ w, dates, count: inside.reduce((n, d) => n + d.total, 0) });
  }
  if (!planned.length) return [];

  // One LIMITed subquery per window, glued with UNION ALL.
  const subs = planned.map(
    ({ w }, i) => sql`SELECT ${i}::int AS idx, x.id, x.exif_timestamp, x.image_hash FROM (
      SELECT p.id, p.exif_timestamp, p.image_hash FROM api_photo p WHERE ${candidates(user)}
        AND EXISTS (SELECT 1 FROM api_albumdate_photos wap JOIN api_albumdate wad ON wad.id = wap.albumdate_id
          WHERE wap.photo_id = p.id AND ${inWindows("wad.date", [w])})
      ORDER BY p.exif_timestamp, p.image_hash, p.id LIMIT ${size}) x`,
  );
  const idRows = await rows<{ idx: number; id: string }>(
    sql`SELECT u.idx, u.id FROM (${sql.join(subs, sql` UNION ALL `)}) u ORDER BY u.idx, u.exif_timestamp, u.image_hash, u.id`,
  );
  const ids: string[][] = planned.map(() => []);
  for (const r of idRows) ids[r.idx]?.push(r.id);
  const photos = new Map((await pigByIds(idRows.map((r) => r.id))).map((p) => [p.id, p]));

  const results: Memory[] = [];
  planned.forEach(({ w, dates, count }, i) => {
    const items: PigPhoto[] = [];
    for (const id of ids[i]) {
      const p = photos.get(id);
      if (p) {
        items.push(p);
        photos.delete(id);
      }
    }
    if (!items.length) return;
    const anchor = w.anchor;
    const dayOf = (s: string) => pyDateFromIsoformat(s)!;
    let rep = dates[0];
    for (const d of dates) {
      const a = Math.abs(dayOf(d) - anchor);
      const b = Math.abs(dayOf(rep) - anchor);
      if (a < b || (a === b && d < rep)) rep = d;
    }
    const location = places.get(rep) ?? dates.map((d) => places.get(d)).find((x) => x !== undefined) ?? "";
    let cover = items[0];
    const key = (p: PigPhoto) => [p.type === "video" ? 1 : 0, -p.rating];
    for (const p of items) {
      const [v, r] = key(p);
      const [cv, cr] = key(cover);
      if (v < cv || (v === cv && r < cr)) cover = p;
    }
    const year = parts(anchor)[0];
    results.push({
      id: `${kind}-${year}`,
      type: kind,
      years_ago: w.yearsAgo,
      year,
      date: rep,
      start_date: dates[0],
      end_date: dates[dates.length - 1],
      location,
      numberOfItems: count,
      cover,
      items,
    });
  });
  return results;
}

export async function memories(user: User, q: QueryMap) {
  const parsed = q.get("date");
  const reference = (parsed !== undefined ? pyDateFromIsoformat(parsed) : null) ?? todayFor(user);
  const windowDays = clampInt(q.get("window"), DEFAULT_WINDOW_DAYS, 0, MAX_WINDOW_DAYS);
  const fallback = parseFlag(q.get("fallback"), true);
  const size = clampInt(q.get("size"), DEFAULT_ITEMS, 1, MAX_ITEMS);

  let results: Memory[] = [];
  const first = await row<{ y: number | null }>(
    sql`SELECT extract(year FROM min(date))::int AS y FROM api_albumdate WHERE owner_id = ${user.id} AND date IS NOT NULL`,
  );
  if (first?.y != null) {
    results = await build(user, dayWindows(reference, first.y, windowDays), size, "years_ago");
    if (!results.length && fallback) results = await build(user, monthWindows(reference, first.y), size, "month_years_ago");
  }
  return { date: iso(reference), window_days: windowDays, results };
}
