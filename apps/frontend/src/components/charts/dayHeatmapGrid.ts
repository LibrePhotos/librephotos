import { DateTime, Info } from "luxon";
import { firstDayOfWeek, isCalendarDay, parseCalendarDay } from "../../util/dateUtils";

export type DayLevel = 0 | 1 | 2 | 3 | 4;

export const DAY_LEVELS: readonly DayLevel[] = [0, 1, 2, 3, 4];

export type DayCell = Readonly<{
  day: string;
  column: number;
  row: number;
  count: number;
  level: DayLevel;
}>;

type MonthTick = Readonly<{ column: number; text: string }>;

export type DayGrid = Readonly<{
  cells: readonly DayCell[];
  weeks: number;
  monthTicks: readonly MonthTick[];
  weekdayLabels: ReadonlyArray<Readonly<{ row: number; text: string }>>;
}>;

export type DayCount = Readonly<{ day: string; count: number }>;

export const DAY_CELL_PX = { min: 12, max: 16 } as const;
export const DAY_CELL_GAP_PX = 3;
export const DAY_HEATMAP_LEFT_PX = 30;

const LABELLED_WEEKDAYS = [1, 3, 5] as const;
const DAY_FORMAT = "yyyy-MM-dd";

const weekdayRow = (day: DateTime, weekStartDay: number) => (day.weekday - weekStartDay + 7) % 7;

const EMPTY_GRID: DayGrid = { cells: [], weeks: 0, monthTicks: [], weekdayLabels: [] };

function countsByDay(counts: readonly DayCount[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const entry of counts) {
    if (isCalendarDay(entry.day) && entry.count > 0) byDay.set(entry.day, entry.count);
  }
  return byDay;
}

const yearOf = (day: string) => Number(day.slice(0, 4));

export function photoYears(counts: readonly DayCount[]): number[] {
  const years = new Set([...countsByDay(counts).keys()].map(yearOf));
  return [...years].sort((a, b) => b - a);
}

export function dayCellPx(width: number, weeks: number): number {
  if (weeks < 1) return DAY_CELL_PX.min;
  const fit = Math.floor((width - DAY_HEATMAP_LEFT_PX - DAY_CELL_GAP_PX * (weeks - 1)) / weeks);
  return Math.min(DAY_CELL_PX.max, Math.max(DAY_CELL_PX.min, fit));
}

export function dayGridWidth(weeks: number, cellPx: number): number {
  return DAY_HEATMAP_LEFT_PX + weeks * cellPx + Math.max(0, weeks - 1) * DAY_CELL_GAP_PX;
}

export function dayLevel(count: number, quartiles: readonly [number, number, number]): DayLevel {
  if (count <= 0) return 0;
  const above = quartiles.reduce((over, edge) => over + (count > edge ? 1 : 0), 0);
  return ([1, 2, 3, 4] as const)[above] ?? 4;
}

export function countQuartiles(counts: readonly number[]): readonly [number, number, number] {
  const sorted = counts.filter(count => count > 0).sort((a, b) => a - b);
  const edge = (share: number) => sorted[Math.floor(share * Math.max(0, sorted.length - 1))] ?? Infinity;
  return [edge(0.25), edge(0.5), edge(0.75)];
}

function lastDayShown(year: number, days: readonly string[], today: DateTime): DateTime {
  const yearEnd = DateTime.local(year, 12, 31);
  if (year < today.year) return yearEnd;
  const lastPhoto = days.at(-1);
  const latest = lastPhoto && lastPhoto > today.toFormat(DAY_FORMAT) ? parseCalendarDay(lastPhoto) : today;
  return latest.startOf("day") < yearEnd ? latest.startOf("day") : yearEnd;
}

export function dayHeatmap(
  counts: readonly DayCount[],
  year: number,
  weekStartDay: number = firstDayOfWeek(),
  today: DateTime = DateTime.now()
): DayGrid {
  const first = DateTime.local(year, 1, 1);
  if (!Number.isInteger(year) || !first.isValid) return EMPTY_GRID;
  const byDay = countsByDay(counts);
  const daysOfYear = [...byDay.keys()].filter(day => yearOf(day) === year).sort();
  const end = lastDayShown(year, daysOfYear, today);
  const offset = weekdayRow(first, weekStartDay);

  const days: DateTime[] = [];
  for (let day = first; day <= end; day = day.plus({ days: 1 })) days.push(day);
  const quartiles = countQuartiles(daysOfYear.map(day => byDay.get(day) ?? 0));

  const monthTicks: MonthTick[] = [];
  const cells = days.map((day, index): DayCell => {
    const key = day.toFormat(DAY_FORMAT);
    const column = Math.floor((index + offset) / 7);
    const count = byDay.get(key) ?? 0;
    if (day.day === 1 && !monthTicks.some(tick => tick.column === column)) {
      monthTicks.push({ column, text: day.toLocaleString({ month: "short" }) });
    }
    return { day: key, column, row: weekdayRow(day, weekStartDay), count, level: dayLevel(count, quartiles) };
  });

  const weekdayLabels = LABELLED_WEEKDAYS.map(weekday => ({
    row: (weekday - weekStartDay + 7) % 7,
    text: Info.weekdays("short")[weekday - 1] ?? "",
  }));

  return { cells, weeks: (cells.at(-1)?.column ?? -1) + 1, monthTicks, weekdayLabels };
}
