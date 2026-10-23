import type { CSSProperties } from "react";
import { alphabetMarkerLetter, isUnknownPersonLabel } from "./alphabetMarker";
import type { ScrollerPosition, ScrollerType } from "./scrollScrubberTypes";

/** A run of positions the density map draws as one bar: a month, a year, a letter, or one label. */
export type DensityBucket = Readonly<{
  label: string;
  /** Where the bar starts and ends on the scrubber, in pixels from its top. */
  start: number;
  end: number;
  /** The photos in the run; a position without a count stands for one. */
  count: number;
}>;

type Unit = "months" | "years";

/** The run a position belongs to, and what that run is called. */
function bucketOf(item: ScrollerPosition, type: ScrollerType, unit: Unit): { key: string; label: string } {
  if (type === "date" && item.year) {
    if (unit === "months" && item.month) return { key: `${item.year}-${item.month}`, label: item.month };
    return { key: String(item.year), label: String(item.year) };
  }
  if (type === "alphabet") {
    const letter = isUnknownPersonLabel(item.label) ? item.label : alphabetMarkerLetter(item.label);
    return { key: letter, label: letter };
  }
  return { key: item.label, label: item.label };
}

function buckets(
  positions: readonly ScrollerPosition[],
  type: ScrollerType,
  unit: Unit,
  trackHeight: number
): DensityBucket[] {
  const runs: { key: string; label: string; start: number; count: number }[] = [];
  for (const item of positions) {
    const { key, label } = bucketOf(item, type, unit);
    const last = runs.at(-1);
    if (last?.key === key) last.count += item.count ?? 1;
    else runs.push({ key, label, start: item.scrollerY, count: item.count ?? 1 });
  }
  return runs.map((run, i) => ({
    label: run.label,
    start: run.start,
    end: runs[i + 1]?.start ?? trackHeight,
    count: run.count,
  }));
}

/**
 * The bars of the density map, sorted by position. Dates are grouped by month, or by year when
 * there are so many months that a bar would be thinner than 3 px.
 */
export function densityBuckets(
  positions: readonly ScrollerPosition[],
  type: ScrollerType,
  trackHeight: number
): DensityBucket[] {
  const byMonth = buckets(positions, type, "months", trackHeight);
  if (type === "date" && byMonth.length > trackHeight / 3) return buckets(positions, type, "years", trackHeight);
  return byMonth;
}

/** The bucket that covers `y`, the last one for a `y` past the end. */
export function bucketAt(buckets: readonly DensityBucket[], y: number): DensityBucket | undefined {
  return buckets.findLast(bucket => y >= bucket.start) ?? buckets[0];
}

// Bar widths in pixels: the emptiest run is MIN wide, the fullest MIN + RANGE.
const MIN_BAR_WIDTH = 4;
const BAR_WIDTH_RANGE = 20;

/** A bar spans its run on the scrubber, 1 px apart from the next, and is as wide as it has photos. */
export const barStyle = (bucket: DensityBucket, fullest: number): CSSProperties => ({
  top: bucket.start,
  height: Math.max(bucket.end - bucket.start - 1, 1),
  width: MIN_BAR_WIDTH + (BAR_WIDTH_RANGE * bucket.count) / fullest,
});
