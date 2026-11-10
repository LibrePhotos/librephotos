import React from "react";
import { useTranslation } from "react-i18next";
import { barPath, barSlots, slotAt, valueAxis } from "./barGeometry";
import { ChartTooltip } from "./ChartTooltip";
import type { MonthBar } from "./photoMonthChart";
import { BAR_GAP_SHARE, PLOT_INSET_LEFT_PX } from "./photoMonthChart";
import classes from "./StatisticsCharts.module.css";
import { useBarFocus } from "./useBarFocus";

/** Room above the plot, and below it for the year labels. */
const TOP_PX = 8;
const BOTTOM_PX = 24;
/** A bar is never wider than this, however few there are. */
const MAX_BAR_PX = 28;
/** The rounding of a bar's top corners. */
const BAR_RADIUS = 2;
/** About the width of a digit of the axis labels (12px), and the gap between the labels and the plot. */
const DIGIT_PX = 7.5;
const LABEL_GAP_PX = 8;
/** Half a year label ("2026"), which is centred under its bar. */
const YEAR_HALF_PX = 15;

/**
 * Where the plot starts: right of the widest count label, which starts at the chart's left edge, in
 * line with the heading above it. Never more than photoMonthChart allowed for when it chose the bars.
 */
export function plotLeft(ticks: readonly number[]): number {
  const widest = Math.max(1, ...ticks.map(tick => String(tick).length));
  return Math.min(PLOT_INSET_LEFT_PX, Math.ceil(widest * DIGIT_PX) + LABEL_GAP_PX);
}

type Props = Readonly<{
  bars: readonly MonthBar[];
  /** The bars whose year is written under them. */
  ticks: readonly string[];
  yearOf: ReadonlyMap<string, string>;
  width: number;
  height: number;
}>;

/**
 * The Timeline chart: one bar per month, quarter or year (photoMonthChart chooses), counts up the side,
 * years along the bottom. Pointing at a bar, tapping it or reaching it with the keyboard shows its
 * period and count; every bar is named for assistive tech, and the chart says what it spans.
 */
export function MonthBarChart({ bars, ticks, yearOf, width, height }: Props) {
  const { t } = useTranslation();
  const axis = valueAxis(Math.max(0, ...bars.map(bar => bar.Photos)));
  // The labels start at the left edge and the plot runs to the right edge, flush with the heading
  // and the card's content.
  const left = plotLeft(axis.ticks);
  const plotWidth = Math.max(0, width - left);
  const plotHeight = Math.max(0, height - TOP_PX - BOTTOM_PX);
  const bottom = TOP_PX + plotHeight;
  const slots = barSlots(bars.length, left, plotWidth, BAR_GAP_SHARE, MAX_BAR_PX);
  const yOf = (value: number) => bottom - (value / axis.max) * plotHeight;
  const { active, show, barProps } = useBarFocus(bars.length);
  const tickSet = new Set(ticks);
  const label = (bar: MonthBar) =>
    t("statistics.barlabel", { label: bar.month, value: t("statistics.photocount", { count: bar.Photos }) });

  const peak = bars.reduce<MonthBar | undefined>(
    (most, bar) => (most && most.Photos >= bar.Photos ? most : bar),
    undefined
  );
  const summary = peak
    ? t("statistics.monthchartsummary", {
        from: bars[0]?.month,
        to: bars.at(-1)?.month,
        peak: peak.month,
        value: t("statistics.photocount", { count: peak.Photos }),
      })
    : "";

  const activeBar = active === null ? undefined : bars[active];
  const activeSlot = active === null ? undefined : slots[active];

  // A pointer: the bar under it, anywhere in its column. A touch shows it until the next touch.
  const fromPointer = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return;
    show(slotAt(event.clientX - box.left, left, slots[0]?.slotWidth ?? 0, bars.length));
  };

  return (
    <div className={classes.chartFrame}>
      <svg width={width} height={height} role="group" aria-label={summary} className={classes.chart}>
        {axis.ticks.map(value => (
          <g key={value}>
            <line x1={left} x2={left + plotWidth} y1={yOf(value)} y2={yOf(value)} className={classes.gridLine} />
            <text x={left - LABEL_GAP_PX} y={yOf(value)} className={classes.valueLabel} aria-hidden>
              {value}
            </text>
          </g>
        ))}
        {activeSlot && (
          <rect
            x={activeSlot.slotX}
            y={TOP_PX}
            width={activeSlot.slotWidth}
            height={plotHeight}
            className={classes.cursor}
          />
        )}
        {bars.map((bar, index) => {
          const slot = slots[index];
          if (!slot) return null;
          return (
            <g key={bar.key} role="img" aria-label={label(bar)} className={classes.bar} {...barProps(index)}>
              <path d={barPath(slot.x, bottom, slot.width, bottom - yOf(bar.Photos), BAR_RADIUS)} />
            </g>
          );
        })}
        {bars.map((bar, index) =>
          tickSet.has(bar.key) ? (
            <text
              key={bar.key}
              // A year under the last bars stays inside the right edge
              x={Math.min(width - YEAR_HALF_PX, (slots[index]?.slotX ?? 0) + (slots[index]?.slotWidth ?? 0) / 2)}
              y={bottom + 16}
              className={classes.yearLabel}
              aria-hidden
            >
              {yearOf.get(bar.key)}
            </text>
          ) : null
        )}
        {/* The pointer's surface over the plot, under no bar's focus ring */}
        <rect
          x={left}
          y={TOP_PX}
          width={plotWidth}
          height={plotHeight}
          className={classes.pointerSurface}
          onPointerMove={fromPointer}
          onPointerDown={fromPointer}
          onPointerLeave={event => {
            if (event.pointerType === "mouse") show(null);
          }}
        />
      </svg>
      <ChartTooltip
        anchorKey={active ?? -1}
        anchor={
          activeBar && activeSlot
            ? {
                x: activeSlot.x,
                y: yOf(activeBar.Photos),
                width: activeSlot.width,
                height: bottom - yOf(activeBar.Photos),
              }
            : null
        }
      >
        {activeBar && (
          <>
            <div className={classes.tooltipTitle}>{activeBar.month}</div>
            <div className={classes.tooltipValue}>{t("statistics.photocount", { count: activeBar.Photos })}</div>
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
