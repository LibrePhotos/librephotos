/** Library dates are local wall-clock milliseconds, so they are read with the UTC getters. */
const month = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
// "Sat, Oct 17" for this year's days, "Sat, Oct 17, 2024" for older ones: the web timeline's day
// header (apps/frontend/src/util/util.ts formatGroupDay).
const dayThisYear = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dayOtherYear = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_MS = 86_400_000;
const monthCache = new Map<number, string>();
const dayCache = new Map<number, string>();

/** "March 2023" (memoised per month: the grid asks for every file). */
export function monthLabel(wallMs: number): string {
  const d = new Date(wallMs);
  const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
  let label = monthCache.get(key);
  if (label === undefined) {
    label = month.format(d);
    monthCache.set(key, label);
  }
  return label;
}

export function dayLabel(wallMs: number): string {
  return day.format(new Date(wallMs));
}

/** The day a wall-clock time falls on, as a whole number (days since 1970-01-01). */
export function dayKey(wallMs: number): number {
  return Math.floor(wallMs / DAY_MS);
}

/** The timeline's day header for a `dayKey` (memoised: every file asks). */
export function groupDayLabel(key: number): string {
  let label = dayCache.get(key);
  if (label === undefined) {
    const d = new Date(key * DAY_MS);
    label = (d.getUTCFullYear() === new Date().getFullYear() ? dayThisYear : dayOtherYear).format(d);
    dayCache.set(key, label);
  }
  return label;
}

/** A server date ("2023-03-15T10:00:00Z", "2023-03-15") as the day it names, or null. */
export function dayKeyOfIso(iso: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return dayKey(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
