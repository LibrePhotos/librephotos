import type { DateTime } from "luxon";
import { parseInstant } from "./dateUtils";

/** From this many days left, the countdown turns red. */
export const TRASH_EXPIRY_WARNING_DAYS = 3;

export type TrashExpiry = {
  /** When the photo was moved to the trash. */
  trashedOn: DateTime;
  /** When the daily cleanup deletes it for good; null while the retention is off. */
  deletedOn: DateTime | null;
  /** Whole days until then, rounded up; 0 once it is due at the next cleanup. Null while off. */
  daysLeft: number | null;
};

/**
 * When a trashed photo goes, from its `trashed_at` and the site's `trash_retention_days` (#2203).
 * The cleanup runs once a day, so a photo past its date is "due at the next cleanup". Null when the
 * photo has no trashed-on date (a server older than the retention, or a photo not in the trash).
 */
export function trashExpiry(
  trashedAt: string | null | undefined,
  retentionDays: number | undefined,
  now: DateTime
): TrashExpiry | null {
  if (!trashedAt) return null;
  const trashedOn = parseInstant(trashedAt);
  if (!trashedOn.isValid) return null;
  if (!retentionDays || retentionDays <= 0) {
    return { trashedOn, deletedOn: null, daysLeft: null };
  }
  const deletedOn = trashedOn.plus({ days: retentionDays });
  const daysLeft = Math.max(0, Math.ceil(deletedOn.diff(now, "days").days));
  return { trashedOn, deletedOn, daysLeft };
}
