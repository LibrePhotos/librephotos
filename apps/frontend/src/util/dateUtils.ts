import { DateTime } from "luxon";

/**
 * Helpers for reading and writing `exif_timestamp`.
 *
 * A photo's `exif_timestamp` is *local wall-clock time* — the time the camera
 * showed when the shot was taken — which the backend deliberately stores tagged
 * as UTC (`dt.replace(tzinfo=pytz.utc)` in `api/date_time_extractor.py`). A
 * photo taken at 14:00 in Tokyo and one taken at 14:00 in Berlin both come back
 * as `...T14:00:00Z`, because the timestamp says "14:00 where the camera was",
 * not "this instant in time".
 *
 * Parsing that with `DateTime.fromISO(ts)` or `new Date(ts)` re-interprets it as
 * a real instant and renders it in the *viewer's* zone, shifting every photo by
 * the viewer's own UTC offset. Reading it back in UTC returns the wall clock
 * unchanged, for every viewer, which is what the date rules promise.
 */

/** Parse an `exif_timestamp` into the wall-clock time the camera recorded. */
export function parsePhotoTimestamp(timestamp: string): DateTime {
  return DateTime.fromISO(timestamp, { zone: "utc" });
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
