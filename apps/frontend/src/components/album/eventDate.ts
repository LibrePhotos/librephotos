import type { DateTime } from "luxon";
import { parsePhotoTimestamp } from "../../util/dateUtils";

// The backend keys an event at its first photo less this (api/autoalbum.py)
const GROUPING_KEY_OFFSET = { hours: 11, minutes: 59 };

/**
 * When an event started: its first photo's wall-clock time, read as UTC like
 * every exif_timestamp.
 *
 * `timestamp` is the event's grouping key, not its date, so showing it put
 * events that started in the morning on the day before. Servers that do not
 * send `start` yet get the key's offset undone.
 */
export function eventStartDate(album: Readonly<{ start?: string | null; timestamp: string }>): DateTime {
  return album.start
    ? parsePhotoTimestamp(album.start)
    : parsePhotoTimestamp(album.timestamp).plus(GROUPING_KEY_OFFSET);
}
