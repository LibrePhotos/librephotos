import { DateTime, Duration, Info, Settings } from "luxon";

/**
 * The date helpers. Parse and format dates only through this module: the UI
 * language is set once, in i18n.ts (luxon's default locale), so formatting needs
 * no `.setLocale()`, and the parsers below say which kind of timestamp a value is.
 *
 * `exif_timestamp` is *local wall-clock time* — the time the camera
 * showed when the shot was taken — which the backend deliberately stores tagged
 * as UTC (`dt.replace(tzinfo=pytz.utc)` in `api/metadata/datetime_rules.py`). A
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

/**
 * Convert an `exif_timestamp` into a JS `Date` whose *local* fields hold the
 * wall clock, for date/time pickers that read `getHours()` and friends.
 *
 * The fields are copied across rather than converted, so the result is the same
 * whatever zone the browser is in.
 */
export function photoTimestampToPickerDate(timestamp: string): Date | null {
  const parsed = parsePhotoTimestamp(timestamp);
  if (!parsed.isValid) {
    return null;
  }
  return new Date(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
    parsed.millisecond
  );
}

/**
 * Read a value out of a date picker as a calendar day.
 *
 * Mantine hands back either a `Date` or a date-only string like `"2023-09-21"`,
 * and `new Date("2023-09-21")` resolves that string to UTC midnight — which is
 * still the *previous* day for anyone west of UTC. Parsing it as a local
 * calendar day keeps the day the user actually clicked.
 */
export function parsePickerDate(value: Date | string): Date | null {
  const parsed = value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value);
  return parsed.isValid ? parsed.toJSDate() : null;
}

/**
 * Inverse of {@link photoTimestampToPickerDate}: turn a picker `Date` back into
 * an `exif_timestamp`, keeping the wall clock the user typed rather than
 * converting it to a real UTC instant.
 */
export function pickerDateToPhotoTimestamp(date: Date): string | null {
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return DateTime.fromObject(
    {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      millisecond: date.getMilliseconds(),
    },
    { zone: "utc" }
  ).toISO();
}

// The string a DateTimePicker with `withSeconds` reads and writes: local wall clock, no zone.
const PICKER_FORMAT = "yyyy-MM-dd HH:mm:ss";

/**
 * A stored instant (an album link's expiry) as the local wall clock a
 * DateTimePicker shows. Empty string when there is no usable instant.
 */
export function toPickerValue(iso: string): string {
  const parsed = parseInstant(iso);
  return parsed.isValid ? parsed.toFormat(PICKER_FORMAT) : "";
}

/**
 * A DateTimePicker value (local wall clock, as the user picked it) as an
 * instant in UTC, ISO 8601 with `Z`. Null when it does not parse.
 */
export function fromPickerValue(value: string): string | null {
  const parsed = DateTime.fromFormat(value, PICKER_FORMAT);
  return parsed.isValid ? parsed.toUTC().toISO() : null;
}

/** The picker value `days` calendar days from now, in the viewer's zone, for the presets. */
export function pickerValueDaysFromNow(days: number): string {
  return DateTime.now().plus({ days }).toFormat(PICKER_FORMAT);
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
