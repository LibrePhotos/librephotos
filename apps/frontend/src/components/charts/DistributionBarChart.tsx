import type { SearchFilters } from "@librephotos/api-client";
import React from "react";
import { useTranslation } from "react-i18next";
import { barPath, barSlots, slotAt, valueAxis } from "./barGeometry";
import { ChartTooltip } from "./ChartTooltip";
import { plotLeft } from "./MonthBarChart";
import { BAR_GAP_SHARE } from "./photoMonthChart";
import classes from "./StatisticsCharts.module.css";
import { useBarFocus } from "./useBarFocus";

const TOP_PX = 8;
const BOTTOM_PX = 24;
const MAX_BAR_PX = 28;
const BAR_RADIUS = 2;
const LABEL_GAP_PX = 8;
const AXIS_LABEL_PX = 40;

export type DistributionBar = Readonly<{
  key: string;
  axis: string;
  name: string;
  count: number;
  search: SearchFilters;
}>;

type Props = Readonly<{
  bars: readonly DistributionBar[];
  summary: string;
  onSelect: (bar: DistributionBar) => void;
  width: number;
  height: number;
}>;

export function DistributionBarChart({ bars, summary, onSelect, width, height }: Props) {
  const { t } = useTranslation();
  const axis = valueAxis(Math.max(0, ...bars.map(bar => bar.count)));
  const left = plotLeft(axis.ticks);
  const plotWidth = Math.max(0, width - left);
  const plotHeight = Math.max(0, height - TOP_PX - BOTTOM_PX);
  const bottom = TOP_PX + plotHeight;
  const slots = barSlots(bars.length, left, plotWidth, BAR_GAP_SHARE, MAX_BAR_PX);
  const yOf = (value: number) => bottom - (value / axis.max) * plotHeight;
  const { active, show, barProps } = useBarFocus(bars.length);
  const labelEvery = Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor(plotWidth / AXIS_LABEL_PX))));
  const label = (bar: DistributionBar) =>
    t("statistics.barlabel", { label: bar.name, value: t("statistics.photocount", { count: bar.count }) });

  const activeBar = active === null ? undefined : bars[active];
  const activeSlot = active === null ? undefined : slots[active];

  const activate = (index: number) => {
    const bar = bars[index];
    if (bar) onSelect(bar);
  };

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
          const props = barProps(index);
          return (
            <g
              key={bar.key}
              role="link"
              aria-label={label(bar)}
              className={classes.barLink}
              ref={props.ref}
              tabIndex={props.tabIndex}
              onFocus={props.onFocus}
              onBlur={props.onBlur}
              onClick={() => activate(index)}
              onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate(index);
                } else {
                  props.onKeyDown(event);
                }
              }}
            >
              <path d={barPath(slot.x, bottom, slot.width, bottom - yOf(bar.count), BAR_RADIUS)} />
            </g>
          );
        })}
        {bars.map((bar, index) =>
          index % labelEvery === 0 ? (
            <text
              key={bar.key}
              x={Math.min(
                width - AXIS_LABEL_PX / 2,
                Math.max(AXIS_LABEL_PX / 2, (slots[index]?.slotX ?? 0) + (slots[index]?.slotWidth ?? 0) / 2)
              )}
              y={bottom + 16}
              className={classes.yearLabel}
              aria-hidden
            >
              {bar.axis}
            </text>
          ) : null
        )}
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
          onClick={event => {
            const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
            if (box) activate(slotAt(event.clientX - box.left, left, slots[0]?.slotWidth ?? 0, bars.length));
          }}
        />
      </svg>
      <ChartTooltip
        anchorKey={active ?? -1}
        anchor={
          activeBar && activeSlot
            ? {
                x: activeSlot.x,
                y: yOf(activeBar.count),
                width: activeSlot.width,
                height: bottom - yOf(activeBar.count),
              }
            : null
        }
      >
        {activeBar && (
          <>
            <div className={classes.tooltipTitle}>{activeBar.name}</div>
            <div className={classes.tooltipValue}>{t("statistics.photocount", { count: activeBar.count })}</div>
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
