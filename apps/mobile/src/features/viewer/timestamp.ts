/**
 * Timestamp editing helpers for the viewer.
 *
 * The web lightbox uses a calendar widget plus a time input; mobile uses the
 * platform pickers (`@react-native-community/datetimepicker`, bundled in Expo
 * Go) in `TimestampPickerModal`. The text helpers below are what the picker's
 * value is written as, and what an older text field read.
 *
 * Everything here is local-time and naive on purpose: LibrePhotos stores
 * `exif_timestamp` as a naive local timestamp (the moment the shutter fired
 * where the photographer was standing), so converting through UTC would shift
 * every photo by the phone's current offset.
 */

const EDITABLE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** Format a stored timestamp for the edit field: `2024-01-03 10:00:00`. */
export function toEditableTimestamp(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  const date =
    typeof value === "number"
      ? new Date(value)
      : // A naive server timestamp has no zone; `new Date` would read a bare
        // "YYYY-MM-DDTHH:mm:ss" as local, which is what we want, but a trailing
        // "Z" or an offset must be respected. Both paths land here.
        new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * Parse the edit field back into the naive `YYYY-MM-DDTHH:mm:ss` the backend
 * accepts, or null when the text is not a usable timestamp.
 *
 * Rejects impossible dates (`2024-02-31`) by round-tripping through `Date` and
 * checking the components survived — `Date` silently rolls them over otherwise,
 * so "31 February" would be saved as 2 March without a word.
 */
export function parseEditableTimestamp(text: string): string | null {
  const match = EDITABLE.exec(text.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)
  ) {
    return null;
  }
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/** The picker's starting value: the photo's own date, or now for a photo without one. */
export function pickerInitialDate(value: number | string | null | undefined, now = new Date()): Date {
  if (value == null || value === "") return now;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? now : date;
}

/** A picked local `Date` as the naive `YYYY-MM-DDTHH:mm:ss` the backend stores. */
export function toNaiveTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
