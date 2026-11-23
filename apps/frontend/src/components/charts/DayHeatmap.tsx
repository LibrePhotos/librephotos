import { useNavigate } from "@tanstack/react-router";
import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCalendarDay } from "../../util/dateUtils";
import { ChartTooltip } from "./ChartTooltip";
import { DAY_CELL_GAP_PX, DAY_CELL_PX, DAY_HEATMAP_LEFT_PX, type DayCell, type DayGrid } from "./dayHeatmap";
import classes from "./StatisticsCharts.module.css";

const TOP_PX = 16;
const LEGEND_GAP_PX = 10;
const LEGEND_WORD_PX = 34;

type Props = Readonly<{
  grid: DayGrid;
  width: number;
}>;

export function DayHeatmap({ grid, width }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { cells, monthTicks, weekdayLabels } = grid;
  const [active, setActive] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const refs = useRef(new Map<number, SVGGElement>());

  if (grid.weeks < 1) return null;

  const cellPx = Math.min(
    DAY_CELL_PX.max,
    Math.max(
      DAY_CELL_PX.min,
      Math.floor((width - DAY_HEATMAP_LEFT_PX - DAY_CELL_GAP_PX * (grid.weeks - 1)) / grid.weeks)
    )
  );
  const x = (column: number) => DAY_HEATMAP_LEFT_PX + column * (cellPx + DAY_CELL_GAP_PX);
  const y = (row: number) => TOP_PX + row * (cellPx + DAY_CELL_GAP_PX);
  const height = TOP_PX + 7 * cellPx + 6 * DAY_CELL_GAP_PX + LEGEND_GAP_PX + cellPx;

  const show = (index: number | null) => {
    setActive(index);
    if (index !== null) setCurrent(index);
  };

  const openDay = (cell: DayCell) => {
    void navigate({ to: "/search", search: { taken_after: cell.day, taken_before: cell.day } });
  };

  const focusCell = (index: number) => {
    refs.current.get(Math.min(cells.length - 1, Math.max(0, index)))?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<SVGGElement>, index: number) => {
    const target: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index + 7,
      ArrowUp: index - 7,
      Home: 0,
      End: cells.length - 1,
    };
    const next = target[event.key];
    if (next !== undefined) {
      event.preventDefault();
      focusCell(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const cell = cells[index];
      if (cell) openDay(cell);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };

  const cellProps = (index: number) => ({
    ref: (element: SVGGElement | null) => {
      if (element) refs.current.set(index, element);
      else refs.current.delete(index);
    },
    tabIndex: index === Math.min(current, cells.length - 1) ? 0 : -1,
    onFocus: () => show(index),
    onBlur: () => setActive(null),
    onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => onKeyDown(event, index),
  });

  const label = (cell: DayCell) =>
    t("statistics.barlabel", {
      label: formatCalendarDay(cell.day),
      value: t("statistics.photocount", { count: cell.count }),
    });

  const peak = cells.reduce<DayCell | undefined>(
    (most, cell) => (most && most.count >= cell.count ? most : cell),
    undefined
  );
  const summary = peak
    ? t("statistics.daychartsummary", {
        from: formatCalendarDay(cells[0]?.day ?? ""),
        to: formatCalendarDay(cells.at(-1)?.day ?? ""),
        peak: formatCalendarDay(peak.day),
        value: t("statistics.photocount", { count: peak.count }),
      })
    : "";

  const activeCell = active === null ? undefined : cells[active];
  const swatchesX = width - LEGEND_WORD_PX - 5 * (cellPx + DAY_CELL_GAP_PX);

  return (
    <div className={classes.chartFrame}>
      <svg width={width} height={height} role="group" aria-label={summary} className={classes.chart}>
        {monthTicks.map(tick => (
          <text
            key={`${tick.column}-${tick.text}`}
            x={Math.min(x(tick.column), Math.max(DAY_HEATMAP_LEFT_PX, width - 32))}
            y={TOP_PX - 5}
            className={classes.monthLabel}
            aria-hidden
          >
            {tick.text}
          </text>
        ))}
        {weekdayLabels.map(labelRow => (
          <text
            key={labelRow.row}
            x={DAY_HEATMAP_LEFT_PX - 6}
            y={y(labelRow.row) + cellPx / 2}
            className={classes.weekdayLabel}
            aria-hidden
          >
            {labelRow.text}
          </text>
        ))}
        {cells.map((cell, index) => (
          <g
            key={cell.day}
            role="link"
            aria-label={label(cell)}
            className={classes.dayCell}
            {...cellProps(index)}
            onClick={() => openDay(cell)}
            onPointerEnter={() => show(index)}
            onPointerLeave={() => setActive(null)}
          >
            <rect
              x={x(cell.column)}
              y={y(cell.row)}
              width={cellPx}
              height={cellPx}
              rx={2}
              className={classes[`level${cell.level}`]}
            />
          </g>
        ))}
        <text x={swatchesX - 6} y={height - cellPx / 2} className={classes.weekdayLabel} aria-hidden>
          {t("statistics.less")}
        </text>
        {[0, 1, 2, 3, 4].map(level => (
          <rect
            key={level}
            x={swatchesX + level * (cellPx + DAY_CELL_GAP_PX)}
            y={height - cellPx}
            width={cellPx}
            height={cellPx}
            rx={2}
            className={classes[`level${level}`]}
            aria-hidden
          />
        ))}
        <text x={width} y={height - cellPx / 2} className={classes.weekdayLabel} aria-hidden>
          {t("statistics.more")}
        </text>
      </svg>
      <ChartTooltip
        anchorKey={active ?? -1}
        anchor={activeCell ? { x: x(activeCell.column), y: y(activeCell.row), width: cellPx, height: cellPx } : null}
      >
        {activeCell && (
          <>
            <div className={classes.tooltipTitle}>{formatCalendarDay(activeCell.day)}</div>
            <div className={classes.tooltipValue}>{t("statistics.photocount", { count: activeCell.count })}</div>
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
