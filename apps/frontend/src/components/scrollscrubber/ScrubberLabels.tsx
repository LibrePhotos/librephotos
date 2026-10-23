import React from "react";
import classes from "./ScrollScrubber.module.css";
import type { ScrollerPosition } from "./scrollScrubberTypes";
import { atPercent } from "./scrubberLayout";

type Props = Readonly<{
  markers: readonly ScrollerPosition[];
  onPick: (marker: ScrollerPosition) => void;
}>;

/** The year, month or letter labels beside the scrubber; a click jumps there. */
export function ScrubberLabels({ markers, onPick }: Props) {
  return markers.map(marker => (
    <button
      key={marker.label}
      type="button"
      // The scrubber is for pointers only (#2245): keyboard users scroll the page itself.
      tabIndex={-1}
      className={classes.marker}
      style={atPercent(marker.scrollerYPercent)}
      // A press on a label is a jump, not the start of a drag along the track.
      onPointerDown={event => event.stopPropagation()}
      onClick={() => onPick(marker)}
    >
      {marker.label}
    </button>
  ));
}
