import { DateTime } from "luxon";

/** One bar: the month's key ("2009-6"), the month as the locale writes it, its year and photo count. */
export type MonthBar = { key: string; month: string; year: number; Photos: number };

/** At most this many year labels on the axis: more years label every second (third...) one. */
const MAX_YEAR_TICKS = 14;

/**
 * The Timeline chart's bars and its x-axis ticks: one tick per year, at the year's first month on
 * the chart, labelled with the year alone, so the axis reads "2009 2010 2011" instead of months
 * that look like days ("Jun 09").
 */
export function photoMonthChart(counts: ReadonlyArray<{ month: string; count: number }>) {
  const bars: MonthBar[] = counts.map(el => {
    // The month string is "YYYY-M"
    const [year, month] = el.month.split("-");
    const date = DateTime.fromObject({ year: parseInt(year ?? "", 10), month: parseInt(month ?? "", 10) });
    return {
      key: el.month,
      month: date.toLocaleString({ year: "numeric", month: "short" }),
      year: date.year,
      Photos: el.count,
    };
  });
  const yearStarts = bars.filter((bar, index) => bars[index - 1]?.year !== bar.year);
  const step = Math.max(1, Math.ceil(yearStarts.length / MAX_YEAR_TICKS));
  const ticks = yearStarts.filter((_bar, index) => index % step === 0).map(bar => bar.key);
  const yearOf = new Map(bars.map(bar => [bar.key, String(bar.year)]));
  return { bars, ticks, yearOf };
}
