import { DateTime, Duration, Info, Interval, Settings } from "luxon";

/**
 * The date helpers. Parse and format dates only through this module: the UI
 * language is set once, in i18n.ts (luxon's default locale), so formatting needs
 * no `.setLocale()`, and the parsers below say which kind of timestamp a value is.
 *
 * `exif_timestamp` is *local wall-clock time* — the time the camera
 * showed when the shot was taken — which the backend deliberately stores tagged
 * as UTC (`dt.replace(tzinfo=UTC)` in `api/metadata/datetime_rules.py`). A
 * photo taken at 14:00 in Tokyo and one taken at 14:00 in Berlin both come back
 * as `...T14:00:00Z`, because the timestamp says "14:00 where the camera was",
 * not "this instant in time".
 *
 * Parsing that with `parseInstant` re-interprets it as a real instant and renders
 * it in the *viewer's* zone, shifting every photo by the viewer's own UTC offset.
 * Reading it back in UTC (`parsePhotoTimestamp`) returns the wall clock
 * unchanged, for every viewer, which is what the date rules promise.
 */

/** Parse an `exif_timestamp` into the wall-clock time the camera recorded. */
export function parsePhotoTimestamp(timestamp: string): DateTime {
  return DateTime.fromISO(timestamp, { zone: "utc" });
}

/**
 * Parse a timestamp that is a real instant (`queued_at`, `date_joined`,
 * `created_on`, memory dates), in the viewer's zone. A date-only string gives
 * local midnight.
 */
export function parseInstant(iso: string): DateTime {
  return DateTime.fromISO(iso);
}

/** A timestamp in seconds since the epoch, such as the location timeline's segment bounds. */
export function fromUnixSeconds(seconds: number): DateTime {
  return DateTime.fromSeconds(seconds);
}

export type WallClock = Readonly<{ day: string; time: string }>;

const DAY_INPUT = "yyyy-MM-dd";
const TIME_INPUT = "HH:mm:ss";
const DATE_TIME_INPUT = "yyyy-MM-dd'T'HH:mm:ss";
const WHOLE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const WHOLE_TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function isWholeTime(time: string): boolean {
  return WHOLE_TIME.test(time);
}

export function photoTimestampWallClock(timestamp: string): WallClock | null {
  const parsed = parsePhotoTimestamp(timestamp);
  return parsed.isValid ? { day: parsed.toFormat(DAY_INPUT), time: parsed.toFormat(TIME_INPUT) } : null;
}

export function wallClockToPhotoTimestamp({ day, time }: WallClock): string | null {
  if (!WHOLE_DAY.test(day) || !isWholeTime(time)) return null;
  const parsed = DateTime.fromISO(`${day}T${time}`, { zone: "utc" });
  return parsed.isValid ? parsed.toISO() : null;
}

export function toDateTimeInputValue(iso: string): string {
  const parsed = parseInstant(iso);
  return parsed.isValid ? parsed.toFormat(DATE_TIME_INPUT) : "";
}

export function fromDateTimeInputValue(value: string): string | null {
  const parsed = value ? DateTime.fromISO(value) : DateTime.invalid("empty");
  return parsed.isValid ? parsed.toUTC().toISO() : null;
}

export function dateTimeInputDaysFromNow(days: number): string {
  return DateTime.now().plus({ days }).startOf("minute").toFormat(DATE_TIME_INPUT);
}

/**
 * The locale whose calendar the date pickers follow: the UI language, with the
 * region of the first browser language in the same language when the UI language
 * has none, so a British user with the UI in plain "en" gets Monday, not en-US's Sunday.
 */
function weekStartLocale(): string | undefined {
  const ui = Settings.defaultLocale;
  if (!ui) return undefined;
  try {
    const { language, region } = new Intl.Locale(ui);
    if (region) return ui;
    const browser = navigator.languages
      .map(tag => new Intl.Locale(tag))
      .find(candidate => candidate.language === language && candidate.region);
    return browser?.toString() ?? ui;
  } catch {
    // A tag Intl.Locale rejects: use the UI language as it is.
    return ui;
  }
}

/**
 * The day a week starts on in the UI language, as the date pickers number it
 * (0 is Sunday, 6 is Saturday). Mantine would otherwise start every week on Monday.
 */
export function firstDayOfWeek(): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  // Luxon numbers the days 1 (Monday) to 7 (Sunday).
  const days = [0, 1, 2, 3, 4, 5, 6] as const;
  return days[Info.getStartOfWeek({ locale: weekStartLocale() }) % 7] ?? 1;
}

/** An `exif_timestamp` moved by `seconds` (negative: earlier), still wall clock tagged UTC. */
export function shiftPhotoTimestamp(timestamp: string, seconds: number): string | null {
  const parsed = parsePhotoTimestamp(timestamp);
  return parsed.isValid ? parsed.plus({ seconds }).toISO() : null;
}

function readInZone(wallClock: DateTime, zone: string): DateTime {
  const zoned = wallClock.setZone(zone, { keepLocalTime: true });
  const candidates = zoned.getPossibleOffsets();
  const standard = candidates.filter(candidate => !candidate.isInDST);
  return (standard.length === 1 ? standard[0] : candidates[candidates.length - 1]) ?? zoned;
}

export function convertPhotoTimestamp(timestamp: string, fromZone: string, toZone: string): string | null {
  const converted = readInZone(parsePhotoTimestamp(timestamp), fromZone).setZone(toZone);
  return converted.isValid ? converted.setZone("utc", { keepLocalTime: true }).toISO() : null;
}

/**
 * A UTC offset in minutes east of UTC (`exif_timestamp_offset`) as "UTC-07:00", "UTC+05:30" or
 * "UTC+00:00": the zone the wall clock of an `exif_timestamp` is in (#2769). Not translated.
 */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const total = Math.abs(minutes);
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const rest = String(total % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${rest}`;
}

/** An `exif_timestamp` as its wall clock to the second, in the UI language ("Oct 9, 2025, 8:14:02 AM"). */
export function formatPhotoDateTime(timestamp: string): string {
  return parsePhotoTimestamp(timestamp).toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);
}

export function formatClockTime(time: string): string {
  const clock = DateTime.fromFormat(time, "HH:mm");
  return clock.isValid ? clock.toLocaleString(DateTime.TIME_SIMPLE) : time;
}

export function formatPhotoDateTimeToMinute(timestamp: string): string {
  return parsePhotoTimestamp(timestamp).toLocaleString(DateTime.DATETIME_MED);
}

const DURATION_UNITS = ["days", "hours", "minutes", "seconds"] as const;

/**
 * A number of seconds spelled out in days, hours, minutes and seconds, in the UI language, leaving
 * out the units that are zero ("1 hour, 30 minutes" for 5400). The sign is ignored.
 */
export function describeDuration(seconds: number): string {
  const parts = Duration.fromObject({ seconds: Math.abs(seconds) })
    .shiftTo(...DURATION_UNITS)
    .toObject();
  const nonZero = Object.fromEntries(DURATION_UNITS.flatMap(unit => (parts[unit] ? [[unit, parts[unit]]] : [])));
  return Duration.fromObject(nonZero).toHuman();
}

/**
 * A moment of a video as its player's time display shows it: "0:42", "12:05", "1:02:03". Partial
 * seconds are dropped and a negative time is 0:00.
 */
export function formatVideoTime(seconds: number): string {
  const duration = Duration.fromObject({ seconds: Math.max(0, Math.floor(seconds)) });
  return duration.toFormat(seconds >= 3600 ? "h:mm:ss" : "m:ss");
}

// A calendar day as the search filters and Mantine's date pickers write it, with no time or zone.
const CALENDAR_DAY_FORMAT = "yyyy-MM-dd";

/** Whether `value` is a real calendar day written `YYYY-MM-DD` (2024-02-30 is not). */
export function isCalendarDay(value: string): boolean {
  return DateTime.fromFormat(value, CALENDAR_DAY_FORMAT).isValid;
}

/** A `YYYY-MM-DD` day with no time or zone (a person's birth date); invalid when it is no day. */
export function parseCalendarDay(day: string): DateTime {
  return DateTime.fromFormat(day, CALENDAR_DAY_FORMAT);
}

/** A `YYYY-MM-DD` day for people, in the UI language ("Mar 1, 2024"); the value itself if it is no day. */
export function formatCalendarDay(day: string): string {
  const parsed = DateTime.fromFormat(day, CALENDAR_DAY_FORMAT);
  return parsed.isValid ? parsed.toLocaleString(DateTime.DATE_MED) : day;
}

/** First and last day of the year `yearsAgo` years before this one (0 is this year), as `YYYY-MM-DD`. */
export function calendarYear(yearsAgo: number): { first: string; last: string } {
  const year = DateTime.now().minus({ years: yearsAgo });
  return {
    first: year.startOf("year").toFormat(CALENDAR_DAY_FORMAT),
    last: year.endOf("year").toFormat(CALENDAR_DAY_FORMAT),
  };
}

/** The day `days` days before today, in the viewer's zone, as `YYYY-MM-DD`. */
export function calendarDaysAgo(days: number): string {
  return DateTime.now().minus({ days }).toFormat(CALENDAR_DAY_FORMAT);
}

/**
 * The days a set of `exif_timestamp`s spans, in the UI language: "Oct 17 – 18, 2026", one day as
 * "Oct 17, 2026"; null when none is a valid timestamp. Read as wall-clock time (`parsePhotoTimestamp`).
 */
export function formatPhotoDaySpan(timestamps: ReadonlyArray<string | null | undefined>): string | null {
  let first: DateTime | null = null;
  let last: DateTime | null = null;
  for (const timestamp of timestamps) {
    if (!timestamp) continue;
    const taken = parsePhotoTimestamp(timestamp);
    if (!taken.isValid) continue;
    if (!first || taken < first) first = taken;
    if (!last || taken > last) last = taken;
  }
  if (!first || !last) return null;
  if (first.hasSame(last, "day")) return first.toLocaleString(DateTime.DATE_MED);
  return Interval.fromDateTimes(first, last).toLocaleString(DateTime.DATE_MED);
}
