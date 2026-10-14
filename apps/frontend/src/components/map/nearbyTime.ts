import { DateTime, Duration } from "luxon";
import type { TimeWindow } from "../../api_client/photos/hooks/useLocatedNearbyQuery";
import { parsePhotoTimestamp } from "../../util/dateUtils";

/** When the photos a location is set for were taken (`exif_timestamp`s): the first and the last. */
export type TakenSpan = Readonly<{ first: string; last: string }>;

/** The window the location picker looks for geotagged photos in: the span plus a day either side. */
export function nearbyWindow(span: TakenSpan | null): TimeWindow | null {
  if (span === null) return null;
  const first = parsePhotoTimestamp(span.first);
  const last = parsePhotoTimestamp(span.last);
  if (!first.isValid || !last.isValid) return null;
  // Kept in UTC like the timestamps themselves, so the server compares wall clocks with wall clocks.
  return { from: isoOf(first.minus({ days: 1 })), to: isoOf(last.plus({ days: 1 })) };
}

function isoOf(time: DateTime): string {
  return time.toISO() ?? "";
}

/** How far a photo was taken from the span, and on which side of it. */
export type TimeOffset = Readonly<{
  side: "before" | "after" | "during";
  /** A whole number of `unit`s; 0 with "during". */
  amount: number;
  unit: "minutes" | "hours" | "days";
}>;

/** `taken` against the span: minutes under an hour, hours under two days, days beyond. */
export function offsetFromSpan(taken: string, span: TakenSpan): TimeOffset {
  const time = parsePhotoTimestamp(taken);
  const first = parsePhotoTimestamp(span.first);
  const last = parsePhotoTimestamp(span.last);
  if (time >= first && time <= last) return { side: "during", amount: 0, unit: "minutes" };
  const side = time < first ? "before" : "after";
  const distance = side === "before" ? first.diff(time) : time.diff(last);
  const hours = distance.as("hours");
  if (hours < 1) return { side, amount: Math.max(1, Math.round(distance.as("minutes"))), unit: "minutes" };
  if (hours < 48) return { side, amount: Math.round(hours), unit: "hours" };
  return { side, amount: Math.round(distance.as("days")), unit: "days" };
}

/** The offset's amount in the UI language ("2 hr", "35 min"). */
export function formatAmount({ amount, unit }: TimeOffset): string {
  return Duration.fromObject({ [unit]: amount }).toHuman({ unitDisplay: "short" });
}

/** When a photo was taken, for its accessible name ("Oct 11, 2026, 9:43 AM"). */
export function formatTaken(taken: string): string {
  return parsePhotoTimestamp(taken).toLocaleString(DateTime.DATETIME_MED);
}
