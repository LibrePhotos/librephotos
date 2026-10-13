import { alphabetMarkerLetter, isUnknownPersonLabel } from "./alphabetMarker";
import type { ScrollerPosition } from "./scrollScrubberTypes";

// Minimum vertical distance between two markers: a marker chip is 18px tall,
// so anything closer overlaps its neighbour.
const MIN_MARKER_GAP = 20;

/** Whether a marker at `item` clears the last marker placed, so the two chips do not overlap. */
function hasRoomAfter(markers: readonly ScrollerPosition[], item: ScrollerPosition): boolean {
  const last = markers.at(-1);
  return last === undefined || item.scrollerY - last.scrollerY > MIN_MARKER_GAP;
}

/** A marker at the position of `item`, reading `label`. */
const markerAt = (item: ScrollerPosition, label: string): ScrollerPosition => ({
  label,
  targetY: item.targetY,
  scrollerY: item.scrollerY,
  scrollerYPercent: item.scrollerYPercent,
});

/** One marker per position, each with its own label, skipping those too close to the previous one. */
export function labelMarkers(positions: readonly ScrollerPosition[]): ScrollerPosition[] {
  const markers: ScrollerPosition[] = [];
  for (const item of positions) {
    if (hasRoomAfter(markers, item)) markers.push(markerAt(item, item.label));
  }
  return markers;
}

/**
 * One marker where the first letter changes (the unknown group keeps its spelled-out name),
 * skipping those too close to the previous one.
 */
export function alphabetMarkers(positions: readonly ScrollerPosition[]): ScrollerPosition[] {
  const markers: ScrollerPosition[] = [];
  let currentLetter: string | null = null;
  for (const item of positions) {
    const letter = alphabetMarkerLetter(item.label);
    const isUnknown = isUnknownPersonLabel(item.label);
    if (letter !== currentLetter || isUnknown) {
      currentLetter = letter;
      if (hasRoomAfter(markers, item)) markers.push(markerAt(item, isUnknown ? item.label : letter));
    }
  }
  return markers;
}

/** What a date marker reads at `unit`: the year, the month, or the position's own label without one. */
function dateLabel(item: ScrollerPosition, unit: "years" | "months"): string {
  if (unit === "years" && item.year) return item.year.toString();
  if (unit === "months" && item.month) return item.month;
  return item.label;
}

/**
 * One marker per year, or per month when there are fewer than 10 years. Per-day labels are long
 * ("Wednesday, March 12, 2025") and cover the grid, so the labels are only used when everything is
 * in one month.
 */
export function dateMarkers(
  positions: readonly ScrollerPosition[],
  unit: "years" | "months" = "years"
): ScrollerPosition[] {
  const markers: ScrollerPosition[] = [];
  let current = "";
  let distinct = 0;
  for (const item of positions) {
    const label = dateLabel(item, unit);
    if (label !== current) {
      current = label;
      distinct += 1;
      if (hasRoomAfter(markers, item)) markers.push(markerAt(item, label));
    }
  }
  if (unit === "years" && distinct < 10) return dateMarkers(positions, "months");
  if (unit === "months" && distinct < 2) return labelMarkers(positions);
  return markers;
}
