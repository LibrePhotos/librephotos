import React from "react";
import classes from "./ScrollScrubber.module.css";
import { atY, thumbTop } from "./scrubberLayout";

type Props = Readonly<{
  /** Where the page is, on the scrubber. */
  currentY: number;
  /** Where the pointer is, or null. */
  hoverY: number | null;
  height: number;
}>;

/** The thumb style: a hairline track with a pill you grab and drag. */
export function ThumbTrack({ currentY, hoverY, height }: Props) {
  return (
    <>
      <div className={classes.track} />
      <div className={classes.thumb} style={atY(thumbTop(currentY, height))} />
      {hoverY !== null && <div className={classes.hoverLine} style={atY(hoverY)} />}
    </>
  );
}
