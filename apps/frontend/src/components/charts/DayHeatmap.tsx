import { Box, Group, Text } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import React, { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCalendarDay } from "../../util/dateUtils";
import { ChartTooltip } from "./ChartTooltip";
import {
  DAY_CELL_GAP_PX,
  DAY_HEATMAP_LEFT_PX,
  DAY_LEVELS,
  dayCellPx,
  dayGridWidth,
  type DayCell,
  type DayGrid,
} from "./dayHeatmapGrid";
import classes from "./StatisticsCharts.module.css";

const TOP_PX = 16;
const MONTH_LABEL_PX = 24;

type Props = Readonly<{
  grid: DayGrid;
  width: number;
}>;

const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 7,
  ArrowLeft: -7,
  ArrowDown: 1,
  ArrowUp: -1,
};

export function DayHeatmap({ grid, width }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { cells, monthTicks, weekdayLabels } = grid;
  const [active, setActive] = useState<number | null>(null);
  const [current, setCurrent] = useState(cells.length - 1);
  const refs = useRef(new Map<number, SVGGElement>());
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [grid]);

  if (grid.weeks < 1) return null;

  const cellPx = dayCellPx(width, grid.weeks);
  const gridWidth = dayGridWidth(grid.weeks, cellPx);
  const x = (column: number) => DAY_HEATMAP_LEFT_PX + column * (cellPx + DAY_CELL_GAP_PX);
  const y = (row: number) => TOP_PX + row * (cellPx + DAY_CELL_GAP_PX);
  const height = TOP_PX + 7 * cellPx + 6 * DAY_CELL_GAP_PX;
  const lastIndex = cells.length - 1;
  const tabStop = Math.min(Math.max(current, 0), lastIndex);

  const show = (index: number | null) => {
    setActive(index);
    if (index !== null) setCurrent(index);
  };

  const openDay = (cell: DayCell) => {
    void navigate({ to: "/search", search: { taken_after: cell.day, taken_before: cell.day } });
  };

  const focusCell = (index: number) => {
    if (index >= 0 && index <= lastIndex) refs.current.get(index)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<SVGGElement>, index: number) => {
    const step = KEY_STEPS[event.key];
    const jump = event.key === "Home" ? 0 : event.key === "End" ? lastIndex : undefined;
    if (step !== undefined || jump !== undefined) {
      event.preventDefault();
      focusCell(jump ?? index + (step ?? 0));
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
    tabIndex: index === tabStop ? 0 : -1,
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

  return (
    <div ref={scrollRef} className={classes.dayScroll}>
      <Box w={gridWidth} className={classes.chartFrame}>
        <svg width={gridWidth} height={height} role="group" aria-label={summary} className={classes.chart}>
          {monthTicks.map(tick => (
            <text
              key={`${tick.column}-${tick.text}`}
              x={Math.min(x(tick.column), Math.max(DAY_HEATMAP_LEFT_PX, gridWidth - MONTH_LABEL_PX))}
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
                data-level={cell.level}
              />
            </g>
          ))}
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
      </Box>
      <Group
        w={gridWidth}
        gap={DAY_CELL_GAP_PX}
        justify="flex-end"
        wrap="nowrap"
        mt="xs"
        className={classes.dayLegend}
        aria-hidden
      >
        <Text size="xs" c="dimmed" mr={4}>
          {t("statistics.less")}
        </Text>
        {DAY_LEVELS.map(level => (
          <Box key={level} w={cellPx} h={cellPx} className={`${classes.daySwatch} ${classes[`level${level}`]}`} />
        ))}
        <Text size="xs" c="dimmed" ml={4}>
          {t("statistics.more")}
        </Text>
      </Group>
    </div>
  );
}
