import { DateTime, Info } from "luxon";

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
 * The day a week starts on in the UI language, as the date pickers number it
 * (0 is Sunday, 6 is Saturday). Mantine would otherwise start every week on Monday.
 */
export function firstDayOfWeek(): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  // Luxon numbers the days 1 (Monday) to 7 (Sunday).
  const days = [0, 1, 2, 3, 4, 5, 6] as const;
  return days[Info.getStartOfWeek() % 7] ?? 1;
}
