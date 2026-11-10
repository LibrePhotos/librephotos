import type { LocationTimeline } from "@librephotos/api-client";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { fromUnixSeconds } from "../../util/dateUtils";
import { ChartTooltip } from "./ChartTooltip";
import classes from "./StatisticsCharts.module.css";
import { useBarFocus } from "./useBarFocus";

/** The bar's band in its 56px box, as the chart drew it before. */
const BAR_TOP_PX = 9;
const BAR_HEIGHT_PX = 37;

type Props = Readonly<{
  stays: LocationTimeline;
  /** Each stay's colour, by its index. */
  colors: readonly string[];
  width: number;
  height: number;
}>;

/** One stay's segment along the bar. */
export type StaySegment = Readonly<{ x: number; width: number }>;

/** The segments of the stays along `width`, each as long as its share of the time. */
export function staySegments(durations: readonly number[], left: number, width: number): StaySegment[] {
  const total = durations.reduce((sum, value) => sum + Math.max(0, value), 0);
  let x = left;
  return durations.map(duration => {
    const segment = { x, width: total > 0 ? (Math.max(0, duration) / total) * width : 0 };
    x += segment.width;
    return segment;
  });
}

/** The segment under `x`, or null outside the bar. */
export function segmentAt(segments: readonly StaySegment[], x: number): number | null {
  const index = segments.findIndex(segment => x >= segment.x && x < segment.x + segment.width);
  return index === -1 ? null : index;
}

const monthYear = (seconds: number) => fromUnixSeconds(seconds).toLocaleString({ year: "numeric", month: "short" });

/**
 * The Location timeline: one bar, a segment per stay in the order of the stays, each as long as the
 * stay. Pointing at a segment, tapping it or reaching it with the keyboard shows the place and its
 * months; every segment is named for assistive tech.
 */
export function StayBarChart({ stays, colors, width, height }: Props) {
  const { t } = useTranslation();
  // Flush with the heading and the legend: the bar runs from edge to edge.
  const segments = staySegments(
    stays.map(stay => stay.data[0] ?? 0),
    0,
    width
  );
  const { active, show, barProps } = useBarFocus(stays.length);
  // Where the pointer is along the bar, which the tooltip stands beside; null for keyboard focus.
  const [pointerX, setPointerX] = useState<number | null>(null);
  const label = (stay: LocationTimeline[number]) =>
    t("statistics.staylabel", { place: stay.loc, from: monthYear(stay.start), to: monthYear(stay.end) });
  const summary = t("statistics.staychartsummary", {
    from: stays[0] ? monthYear(stays[0].start) : "",
    to: stays.at(-1) ? monthYear(stays.at(-1)?.end ?? 0) : "",
  });

  const activeStay = active === null ? undefined : stays[active];
  const activeSegment = active === null ? undefined : segments[active];

  const fromPointer = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - box.left;
    setPointerX(x);
    show(segmentAt(segments, x));
  };
  // Beside the pointer (or the middle of the focused stay) at the bar's height: above the bar it
  // covered the heading, below it the legend.
  const tooltipX = activeSegment ? (pointerX ?? activeSegment.x + activeSegment.width / 2) : 0;

  return (
    <div className={classes.chartFrame}>
      <svg
        width={width}
        height={height}
        role="group"
        aria-label={summary}
        className={classes.chart}
        data-active={active === null ? undefined : true}
      >
        {stays.map((stay, index) => {
          const segment = segments[index];
          if (!segment) return null;
          return (
            <g
              key={`${stay.start}-${stay.loc}`}
              role="img"
              aria-label={label(stay)}
              className={classes.stay}
              data-active={index === active || undefined}
              {...barProps(index)}
              onFocus={() => {
                setPointerX(null);
                barProps(index).onFocus();
              }}
            >
              <rect
                x={segment.x}
                y={BAR_TOP_PX}
                width={segment.width}
                height={BAR_HEIGHT_PX}
                rx={2}
                fill={colors[index]}
                className={classes.staySegment}
              />
            </g>
          );
        })}
        <rect
          x={0}
          y={BAR_TOP_PX}
          width={width}
          height={BAR_HEIGHT_PX}
          className={classes.pointerSurface}
          onPointerMove={fromPointer}
          onPointerDown={fromPointer}
          onPointerLeave={event => {
            if (event.pointerType === "mouse") show(null);
          }}
        />
      </svg>
      <ChartTooltip
        position="right"
        anchorKey={`${active ?? -1}-${Math.round(tooltipX)}`}
        anchor={activeSegment ? { x: tooltipX, y: BAR_TOP_PX, width: 0, height: BAR_HEIGHT_PX } : null}
      >
        {activeStay && (
          <>
            <div className={classes.tooltipTitle}>
              <svg width={10} height={10} className={classes.swatch} aria-hidden>
                <rect width={10} height={10} rx={2} fill={colors[active ?? 0]} />
              </svg>
              {activeStay.loc}
            </div>
            <div className={classes.tooltipValue}>
              {monthYear(activeStay.start)} – {monthYear(activeStay.end)}
            </div>
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
