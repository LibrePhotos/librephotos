import type { CSSProperties } from "react";
import { parseInstant } from "../../util/dateUtils";
import type { ScrollerData, ScrollerPosition, ScrollerType } from "./scrollScrubberTypes";
import { alphabetMarkers, dateMarkers, labelMarkers } from "./scrubberMarkers";

/** Height of the thumb, in pixels. */
export const THUMB_HEIGHT = 36;
// The viewport bracket of the density map never gets thinner than this.
const MIN_BRACKET_HEIGHT = 14;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

type Scale = Readonly<{
  /** Scrubber height in pixels. */
  height: number;
  /** How far the page scrolls before the target starts; see useScrubberGeometry. */
  scrollOffset: number;
  /** How far the page can scroll. */
  scrollRange: number;
}>;

/** Where a scroll position of the page lies on the scrubber, in pixels from its top. */
export function scrollToScrollerY(scroll: number, { height, scrollRange }: Scale): number {
  return scrollRange > 0 ? Math.min((scroll * height) / scrollRange, height) : 0;
}

/** The page's scroll position for a point on the scrubber. */
export function scrollerYToScroll(y: number, { height, scrollRange }: Scale): number {
  return height > 0 ? (y * scrollRange) / height : 0;
}

/** The positions placed on the scrubber, sorted top to bottom, months spelled out for date scrubbers. */
export function layoutPositions(data: readonly ScrollerData[], type: ScrollerType, scale: Scale): ScrollerPosition[] {
  const { scrollOffset, scrollRange } = scale;
  const positions = data.map(item => {
    const scroll = scrollOffset + item.targetY;
    const position: ScrollerPosition = {
      label: item.label,
      targetY: item.targetY,
      scrollerY: scrollToScrollerY(scroll, scale),
      scrollerYPercent: scrollRange > 0 ? Math.min((scroll * 100) / scrollRange, 100) : 0,
      count: item.count,
    };
    if (type === "date") {
      position.year = item.year;
      if (item.year && item.month) {
        position.month = parseInstant(`${item.year}-${item.month.toString().padStart(2, "0")}-01`).toLocaleString({
          year: "numeric",
          month: "short",
        });
      }
    }
    return position;
  });
  return positions.sort((a, b) => (a.targetY > b.targetY ? 1 : -1));
}

/** The labelled markers for `type`; plain labels when there are fewer than 10 positions. */
export function markersFor(positions: readonly ScrollerPosition[], type: ScrollerType): ScrollerPosition[] {
  if (positions.length < 10 || type === "labels") return labelMarkers(positions);
  return type === "alphabet" ? alphabetMarkers(positions) : dateMarkers(positions);
}

/** The label of the last position at or above `y`. */
export function labelAt(positions: readonly ScrollerPosition[], y: number): string {
  return positions.findLast(position => y >= position.scrollerY)?.label ?? "";
}

/** Places an element `y` pixels from the top of the scrubber. */
export const atY = (y: number): CSSProperties => ({ top: y });

/** Places an element `percent` of the way down the scrubber. */
export const atPercent = (percent: number): CSSProperties => ({ top: `${percent}%` });

/** Where the scrubber starts, and where it ends: above the phone footer below the sm breakpoint. */
export const scrubberStyle = (offsetTop: number, isDesktop: boolean): CSSProperties => ({
  top: offsetTop,
  bottom: isDesktop ? "0" : "50px",
});

/** The top of the thumb when the page is at `currentY`, kept inside the track. */
export function thumbTop(currentY: number, height: number): number {
  return clamp(currentY - THUMB_HEIGHT / 2, 0, height - THUMB_HEIGHT);
}

/** The bracket over the density map that stands for what is on screen. */
export function viewportBracket(
  currentY: number,
  { height, scrollRange, viewportHeight }: Readonly<{ height: number; scrollRange: number; viewportHeight: number }>
): CSSProperties & { top: number; height: number } {
  const bracketHeight = clamp((height * viewportHeight) / (scrollRange + viewportHeight), MIN_BRACKET_HEIGHT, height);
  const top = height > 0 ? (currentY / height) * (height - bracketHeight) : 0;
  return { top, height: bracketHeight };
}
