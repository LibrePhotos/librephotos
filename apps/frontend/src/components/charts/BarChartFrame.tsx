import React, { useRef } from "react";
import { axisLabelPlacement, barPath, barSlots, slotAt, valueAxis } from "./barGeometry";
import { ChartTooltip } from "./ChartTooltip";
import { BAR_GAP_SHARE, PLOT_INSET_LEFT_PX } from "./photoMonthChart";
import classes from "./StatisticsCharts.module.css";
import { useBarFocus } from "./useBarFocus";

const TOP_PX = 8;
const BOTTOM_PX = 24;
const MAX_BAR_PX = 28;
const BAR_RADIUS = 2;
const DIGIT_PX = 7.5;
const LABEL_GAP_PX = 8;
const AXIS_LABEL_OFFSET_PX = 16;

export function plotLeft(ticks: readonly number[]): number {
  const widest = Math.max(1, ...ticks.map(tick => String(tick).length));
  return Math.min(PLOT_INSET_LEFT_PX, Math.ceil(widest * DIGIT_PX) + LABEL_GAP_PX);
}

export type AxisLabel = Readonly<{ index: number; text: string }>;

type Props = Readonly<{
  counts: readonly number[];
  keyOf: (index: number) => string;
  summary: string;
  barLabel: (index: number) => string;
  tooltip: (index: number) => React.ReactNode;
  axisLabels: (plotWidth: number) => readonly AxisLabel[];
  axisLabelHalfWidth: number;
  width: number;
  height: number;
  onActivate?: (index: number) => void;
}>;

export function BarChartFrame({
  counts,
  keyOf,
  summary,
  barLabel,
  tooltip,
  axisLabels,
  axisLabelHalfWidth,
  width,
  height,
  onActivate,
}: Props) {
  const axis = valueAxis(Math.max(0, ...counts));
  const left = plotLeft(axis.ticks);
  const plotWidth = Math.max(0, width - left);
  const plotHeight = Math.max(0, height - TOP_PX - BOTTOM_PX);
  const bottom = TOP_PX + plotHeight;
  const slots = barSlots(counts.length, left, plotWidth, BAR_GAP_SHARE, MAX_BAR_PX);
  const yOf = (value: number) => bottom - (value / axis.max) * plotHeight;
  const { active, show, barProps } = useBarFocus(counts.length);
  const touchTap = useRef<{ index: number; shown: boolean } | null>(null);

  const activeSlot = active === null ? undefined : slots[active];
  const activeCount = active === null ? undefined : counts[active];

  const indexAt = (event: React.MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return -1;
    return slotAt(event.clientX - box.left, left, slots[0]?.slotWidth ?? 0, counts.length);
  };

  const fromPointer = (event: React.PointerEvent<SVGRectElement>) => {
    const index = indexAt(event);
    if (index < 0) return;
    show(index);
  };

  const onPointerDown = (event: React.PointerEvent<SVGRectElement>) => {
    const index = indexAt(event);
    if (index < 0) return;
    touchTap.current = event.pointerType === "touch" ? { index, shown: active === index } : null;
    show(index);
  };

  const onSurfaceClick = (event: React.MouseEvent<SVGRectElement>) => {
    if (!onActivate) return;
    const index = indexAt(event);
    const tap = touchTap.current;
    touchTap.current = null;
    if (index < 0) return;
    if (tap && !(tap.index === index && tap.shown)) return;
    onActivate(index);
  };

  const linkProps = (index: number, onKeyDown: (event: React.KeyboardEvent) => void) =>
    onActivate
      ? {
          role: "link",
          className: classes.barLink,
          onClick: () => onActivate(index),
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActivate(index);
            } else {
              onKeyDown(event);
            }
          },
        }
      : { role: "img", className: classes.bar, onKeyDown };

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
        {counts.map((count, index) => {
          const slot = slots[index];
          if (!slot) return null;
          const { onKeyDown, ...focusProps } = barProps(index);
          return (
            <g key={keyOf(index)} aria-label={barLabel(index)} {...focusProps} {...linkProps(index, onKeyDown)}>
              <path d={barPath(slot.x, bottom, slot.width, bottom - yOf(count), BAR_RADIUS)} />
            </g>
          );
        })}
        {axisLabels(plotWidth).map(({ index, text }) => {
          const slot = slots[index];
          if (!slot) return null;
          const placement = axisLabelPlacement(slot.slotX + slot.slotWidth / 2, axisLabelHalfWidth, width);
          return (
            <text
              key={keyOf(index)}
              x={placement.x}
              y={bottom + AXIS_LABEL_OFFSET_PX}
              className={classes.axisLabel}
              data-anchor={placement.anchor}
              aria-hidden
            >
              {text}
            </text>
          );
        })}
        <rect
          x={left}
          y={TOP_PX}
          width={plotWidth}
          height={plotHeight}
          className={onActivate ? classes.linkSurface : classes.pointerSurface}
          onPointerMove={fromPointer}
          onPointerDown={onPointerDown}
          onPointerLeave={event => {
            if (event.pointerType === "mouse") show(null);
          }}
          onClick={onSurfaceClick}
        />
      </svg>
      <ChartTooltip
        anchorKey={active ?? -1}
        anchor={
          activeSlot && activeCount !== undefined
            ? {
                x: activeSlot.x,
                y: yOf(activeCount),
                width: activeSlot.width,
                height: bottom - yOf(activeCount),
              }
            : null
        }
      >
        {active !== null && tooltip(active)}
      </ChartTooltip>
    </div>
  );
}
