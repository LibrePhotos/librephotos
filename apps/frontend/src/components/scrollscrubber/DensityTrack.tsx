import React from "react";
import classes from "./ScrollScrubber.module.css";
import { barStyle, bucketAt } from "./scrubberDensity";
import type { DensityBucket } from "./scrubberDensity";
import { viewportBracket } from "./scrubberLayout";

type Props = Readonly<{
  buckets: readonly DensityBucket[];
  /** Where the page is, on the scrubber. */
  currentY: number;
  /** Where the pointer is, or null. */
  hoverY: number | null;
  height: number;
  scrollRange: number;
  viewportHeight: number;
}>;

/**
 * The density style: one bar per month (or year), as wide as it has photos, and a bracket over
 * what is on screen.
 */
export function DensityTrack({ buckets, currentY, hoverY, height, scrollRange, viewportHeight }: Props) {
  const fullest = Math.max(1, ...buckets.map(bucket => bucket.count));
  const current = bucketAt(buckets, currentY);
  const hovered = hoverY === null ? undefined : bucketAt(buckets, hoverY);
  const bracket = viewportBracket(currentY, { height, scrollRange, viewportHeight });
  return (
    <>
      <div className={classes.panel} />
      {buckets.map(bucket => (
        <div
          key={`${bucket.label}-${bucket.start}`}
          className={classes.bar}
          data-current={bucket === current || undefined}
          data-hovered={bucket === hovered || undefined}
          style={barStyle(bucket, fullest)}
        />
      ))}
      <div className={classes.bracket} style={bracket} />
    </>
  );
}
