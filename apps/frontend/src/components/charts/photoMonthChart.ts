import { DateTime, Interval } from "luxon";

/** How many months one bar adds up: a month, a quarter or a year. */
type ChartBucket = 1 | 3 | 12;

/** One bar: its key ("2009-4"), what the tooltip names ("Apr – Jun 2009"), its year and photo count. */
export type MonthBar = { key: string; month: string; year: number; Photos: number };

/** The narrowest slot a bar gets: a 6px bar and its gap (`BAR_GAP` of the slot). */
const MIN_SLOT_PX = 8;

/** The share of a slot left empty between two bars. */
export const BAR_GAP = "25%";

/** About this much axis room per year label, so the labels never touch. */
const YEAR_LABEL_PX = 56;

/** The y axis and the chart's own padding, which the plot does not get. */
const PLOT_INSET_PX = 56;

const BUCKETS: ReadonlyArray<ChartBucket> = [1, 3, 12];

function parseMonth(month: string) {
  // The month string is "YYYY-M"
  const [year, monthOfYear] = month.split("-");
  return DateTime.fromObject({ year: parseInt(year ?? "", 10), month: parseInt(monthOfYear ?? "", 10) });
}

/** The bars a span of `monthCount` months needs at most once grouped by `bucket` (a span need not start on a quarter). */
function slotsFor(monthCount: number, bucket: ChartBucket) {
  return Math.ceil(monthCount / bucket) + 1;
}

/**
 * The finest grouping whose bars still get `MIN_SLOT_PX` on a plot `width` wide: months on a wide
 * screen or a short span, quarters for a decade on a laptop, years on a phone. Without a width yet,
 * years, so a first paint never draws needles.
 */
export function chartBucket(monthCount: number, width: number): ChartBucket {
  const plot = width - PLOT_INSET_PX;
  return BUCKETS.find(bucket => plot / slotsFor(monthCount, bucket) >= MIN_SLOT_PX) ?? 12;
}

function bucketLabel(start: DateTime, bucket: ChartBucket) {
  if (bucket === 12) return start.toLocaleString({ year: "numeric" });
  if (bucket === 1) return start.toLocaleString({ year: "numeric", month: "short" });
  // "Apr – Jun 2009", the range as the locale writes it
  return Interval.fromDateTimes(start, start.plus({ months: 2 })).toLocaleString({ year: "numeric", month: "short" });
}

/**
 * The Timeline chart's bars and its x-axis ticks for a plot `width` pixels wide. The server counts
 * months; a span too long for month bars at least 6px wide adds them up by quarter or by year. The
 * axis has one tick per year, at the year's first bar, labelled with the year alone ("2009 2010"),
 * every second (third...) year when they would crowd.
 */
export function photoMonthChart(counts: ReadonlyArray<{ month: string; count: number }>, width: number) {
  const bucket = chartBucket(counts.length, width);
  const bars: MonthBar[] = [];
  for (const el of counts) {
    const date = parseMonth(el.month);
    // The first month of the bar's quarter or year
    const start = date.set({ month: date.month - ((date.month - 1) % bucket) });
    const key = `${start.year}-${start.month}`;
    const last = bars.at(-1);
    if (last?.key === key) {
      last.Photos += el.count;
    } else {
      bars.push({ key, month: bucketLabel(start, bucket), year: start.year, Photos: el.count });
    }
  }
  const yearStarts = bars.filter((bar, index) => bars[index - 1]?.year !== bar.year);
  const maxTicks = Math.max(2, Math.floor((width - PLOT_INSET_PX) / YEAR_LABEL_PX));
  const step = Math.max(1, Math.ceil(yearStarts.length / maxTicks));
  const ticks = yearStarts.filter((_bar, index) => index % step === 0).map(bar => bar.key);
  const yearOf = new Map(bars.map(bar => [bar.key, String(bar.year)]));
  return { bars, ticks, yearOf, bucket };
}
