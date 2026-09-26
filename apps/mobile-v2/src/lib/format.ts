/**
 * Display formatting helpers.
 *
 * Dates were previously not formatted at all: timeline section headers rendered
 * the raw `bucket_day` column, i.e. an ISO `2026-07-24`, and the viewer's info
 * sheet printed the server's raw `exif_timestamp`. Everything user-facing goes
 * through the helpers below, which are locale-aware via `Intl` — the app ships
 * a 33-locale registry, so a hardcoded English format would be wrong for most
 * of its users.
 */

/** Words only the UI layer knows (they come from i18n, not from `Intl`). */
export type DayLabels = { today: string; yesterday: string };

export type DateFormatOptions = {
  /** BCP-47 tag; defaults to the runtime locale. Pass `i18n.language`. */
  locale?: string;
  /** Reference "now" for the today/yesterday window. Defaults to the clock. */
  now?: Date;
  labels?: DayLabels;
};

/**
 * Parse a `YYYY-MM-DD` day key as a **local** calendar date. `new Date(string)`
 * would read it as UTC and shift the day backwards for anyone west of
 * Greenwich; the mirror writes these keys with SQLite's `'localtime'`, so they
 * are local by construction and must be parsed that way.
 */
function parseDayKey(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole calendar days between two local dates (b - a), ignoring the clock. */
function calendarDaysBetween(a: Date, b: Date): number {
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

function toDate(value: string | number | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = dayOnly ? parseDayKey(value) : new Date(value);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/**
 * A timeline section header. "Today"/"Yesterday" for the last two days, weekday
 * + day + month within the current year, and the year added beyond it.
 *
 * `labels` carries the localized Today/Yesterday words; without them the
 * absolute date is used, which is correct if less friendly.
 */
export function formatDayHeading(day: string, opts: DateFormatOptions = {}): string {
  const date = parseDayKey(day);
  if (!date) return day; // never render worse than the raw key
  const now = opts.now ?? new Date();
  const delta = calendarDaysBetween(date, now);
  if (opts.labels) {
    if (delta === 0) return opts.labels.today;
    if (delta === 1) return opts.labels.yesterday;
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(opts.locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** A month bucket header: `2026-07` → "July 2026" (never the raw key). */
export function formatMonthHeading(month: string, opts: { locale?: string } = {}): string {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) return month;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return date.toLocaleDateString(opts.locale, { month: "long", year: "numeric" });
}

/**
 * A full date for detail views (the viewer's info sheet). Accepts an ISO string,
 * an ms epoch, or a Date; returns an empty string for anything unparseable so
 * callers can fall back to a placeholder.
 */
export function formatFullDate(
  value: string | number | Date | null | undefined,
  opts: { locale?: string; withTime?: boolean } = {}
): string {
  if (value == null || value === "") return "";
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString(opts.locale, {
    dateStyle: "long",
    ...(opts.withTime === false ? {} : { timeStyle: "short" }),
  });
}

/** Human-readable byte size (e.g. 1536 → "1.5 KB", 0 → "0 B"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  // One decimal for sub-10 fractional values; drop a trailing ".0".
  const rounded = i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}
