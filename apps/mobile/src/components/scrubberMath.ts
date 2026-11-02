import type { TimelineBucket } from "@/db/types";

/**
 * Where each day starts on the scrubber track, as a fraction of the whole
 * library (0 = newest, top). A day takes space in proportion to its photo
 * count, so a busy holiday is easier to hit than a quiet Tuesday, and the
 * track covers the whole library, not just the rows loaded so far.
 */
export type ScrubberIndex = {
  days: string[];
  /** starts[i] = fraction where days[i] begins; one extra entry of 1 at the end. */
  starts: number[];
  /** Photos before each day, newest first (what has to be loaded to show it). */
  before: number[];
  total: number;
};

export function scrubberIndex(buckets: readonly TimelineBucket[]): ScrubberIndex {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const days: string[] = [];
  const starts: number[] = [];
  const before: number[] = [];
  let seen = 0;
  for (const b of buckets) {
    days.push(b.bucket_day);
    starts.push(total > 0 ? seen / total : 0);
    before.push(seen);
    seen += b.count;
  }
  starts.push(1);
  return { days, starts, before, total };
}

/**
 * Rows the timeline list will have: a header per day plus its photo rows. A
 * scrubber pays off once the list is long, whatever the photo count: forty
 * days of one photo each scroll as far as a hundred photos on two days.
 */
export function estimatedRows(buckets: readonly TimelineBucket[], columns = 3): number {
  return buckets.reduce((rows, b) => rows + 1 + Math.ceil(b.count / columns), 0);
}

/** The day under a point of the track (fraction 0..1). */
export function dayAtFraction(index: ScrubberIndex, fraction: number): string | null {
  if (index.days.length === 0) return null;
  const f = Math.min(Math.max(fraction, 0), 1);
  // Last day whose start is at or above f; binary search over the sorted starts.
  let lo = 0;
  let hi = index.days.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (index.starts[mid] <= f) lo = mid;
    else hi = mid - 1;
  }
  return index.days[lo];
}

/** Where a day sits on the track; 0 when it is not in the library. */
export function fractionOfDay(index: ScrubberIndex, day: string | null): number {
  if (day == null) return 0;
  const i = index.days.indexOf(day);
  return i < 0 ? 0 : index.starts[i];
}

/** How many photos come before `day` (newest first); 0 when unknown. */
export function photosBefore(index: ScrubberIndex, day: string): number {
  const i = index.days.indexOf(day);
  return i < 0 ? 0 : index.before[i];
}

/** The first day of each year, with its place on the track: the year marks. */
export function yearMarks(index: ScrubberIndex): { year: string; fraction: number }[] {
  const marks: { year: string; fraction: number }[] = [];
  let lastYear: string | null = null;
  index.days.forEach((day, i) => {
    const year = day.slice(0, 4);
    if (year !== lastYear) {
      marks.push({ year, fraction: index.starts[i] });
      lastYear = year;
    }
  });
  return marks;
}

/**
 * The year marks that fit on a track `height` px tall: a mark closer than
 * `minGap` px to the last one shown is dropped, so busy years do not print on
 * top of each other.
 */
export function spacedMarks(
  marks: readonly { year: string; fraction: number }[],
  height: number,
  minGap = 18
): { year: string; top: number }[] {
  const shown: { year: string; top: number }[] = [];
  for (const m of marks) {
    const top = m.fraction * height;
    const last = shown[shown.length - 1];
    if (!last || top - last.top >= minGap) shown.push({ year: m.year, top });
  }
  return shown;
}

/** "Feb 2021": the label next to the thumb while dragging. */
export function monthLabel(day: string, locale: string): string {
  const [y, m] = day.split("-").map(Number);
  if (!y || !m) return day;
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: "short", year: "numeric" });
}
