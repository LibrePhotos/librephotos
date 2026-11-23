import { Info, type DateTime } from "luxon";
import { firstDayOfWeek, isCalendarDay, parseCalendarDay } from "../../util/dateUtils";

export type DayCell = Readonly<{
  day: string;
  column: number;
  row: number;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}>;

type MonthTick = Readonly<{ column: number; text: string }>;

export type DayGrid = Readonly<{
  cells: readonly DayCell[];
  weeks: number;
  monthTicks: readonly MonthTick[];
  weekdayLabels: ReadonlyArray<Readonly<{ row: number; text: string }>>;
}>;

const DAY_HEATMAP_WEEKS = 53;
export const DAY_CELL_PX = { min: 6, max: 16 } as const;
export const DAY_CELL_GAP_PX = 3;
export const DAY_HEATMAP_LEFT_PX = 30;

const LABELLED_WEEKDAYS = [1, 3, 5] as const;

const dayZero = (weekday: number) => weekday % 7;

function weekStart(day: DateTime, weekStartDay: number): DateTime {
  return day.minus({ days: (dayZero(day.weekday) - weekStartDay + 7) % 7 });
}

export function weeksForWidth(width: number): number {
  const fit = Math.floor((width - DAY_HEATMAP_LEFT_PX + DAY_CELL_GAP_PX) / (DAY_CELL_PX.min + DAY_CELL_GAP_PX));
  return Math.min(DAY_HEATMAP_WEEKS, Math.max(0, fit));
}

export function dayLevel(count: number, quartiles: readonly [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  const above = quartiles.reduce((over, edge) => over + (count > edge ? 1 : 0), 0);
  return ([1, 2, 3, 4] as const)[above] ?? 4;
}

export function countQuartiles(counts: readonly number[]): readonly [number, number, number] {
  const sorted = counts.filter(count => count > 0).sort((a, b) => a - b);
  const edge = (share: number) => sorted[Math.floor(share * Math.max(0, sorted.length - 1))] ?? Infinity;
  return [edge(0.25), edge(0.5), edge(0.75)];
}

export function dayHeatmap(
  counts: ReadonlyArray<{ day: string; count: number }>,
  maxWeeks: number = DAY_HEATMAP_WEEKS,
  weekStartDay = firstDayOfWeek()
): DayGrid {
  const empty: DayGrid = { cells: [], weeks: 0, monthTicks: [], weekdayLabels: [] };
  if (maxWeeks < 1) return empty;
  const byDay = new Map<string, number>();
  for (const entry of counts) {
    if (isCalendarDay(entry.day) && entry.count > 0) byDay.set(entry.day, entry.count);
  }
  const days = [...byDay.keys()].sort();
  const lastDay = days.at(-1);
  const end = lastDay === undefined ? null : parseCalendarDay(lastDay);
  if (!end?.isValid) return empty;

  const lastWeekStart = weekStart(end, weekStartDay);
  let firstWeekStart = lastWeekStart.minus({ weeks: maxWeeks - 1 });
  const firstDay = parseCalendarDay(days[0] ?? "");
  if (firstDay.isValid) {
    const firstWeek = weekStart(firstDay, weekStartDay);
    if (firstWeek > firstWeekStart) firstWeekStart = firstWeek;
  }
  const weeks = Math.round(lastWeekStart.diff(firstWeekStart, "weeks").weeks) + 1;
  const quartiles = countQuartiles([...byDay.values()]);

  const cells: DayCell[] = [];
  const monthTicks: MonthTick[] = [];
  let day = firstWeekStart;
  while (day <= end) {
    const key = day.toFormat("yyyy-MM-dd");
    const column = Math.floor(day.diff(firstWeekStart, "days").days / 7);
    const row = (dayZero(day.weekday) - weekStartDay + 7) % 7;
    const count = byDay.get(key) ?? 0;
    cells.push({ day: key, column, row, count, level: dayLevel(count, quartiles) });
    if (day.day === 1 && !monthTicks.some(tick => tick.column === column)) {
      monthTicks.push({ column, text: day.toLocaleString({ month: "short" }) });
    }
    day = day.plus({ days: 1 });
  }

  const weekdayLabels = LABELLED_WEEKDAYS.map(weekday => ({
    row: (dayZero(weekday) - weekStartDay + 7) % 7,
    text: Info.weekdays("short")[weekday - 1] ?? "",
  }));

  return { cells, weeks, monthTicks, weekdayLabels };
}
