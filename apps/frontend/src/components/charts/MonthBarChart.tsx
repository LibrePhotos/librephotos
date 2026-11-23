import { useTranslation } from "react-i18next";
import { BarChartFrame } from "./BarChartFrame";
import type { MonthBar } from "./photoMonthChart";
import classes from "./StatisticsCharts.module.css";

export { plotLeft } from "./BarChartFrame";

/** Half a year label ("2026"), which is centred under its bar. */
const YEAR_HALF_PX = 15;

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
  const tickSet = new Set(ticks);
  const photoCount = (bar: MonthBar | undefined) => t("statistics.photocount", { count: bar?.Photos ?? 0 });

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

  const axisLabels = bars.flatMap((bar, index) =>
    tickSet.has(bar.key) ? [{ index, text: yearOf.get(bar.key) ?? "" }] : []
  );

  return (
    <BarChartFrame
      counts={bars.map(bar => bar.Photos)}
      keyOf={index => bars[index]?.key ?? String(index)}
      summary={summary}
      barLabel={index => t("statistics.barlabel", { label: bars[index]?.month, value: photoCount(bars[index]) })}
      tooltip={index => (
        <>
          <div className={classes.tooltipTitle}>{bars[index]?.month}</div>
          <div className={classes.tooltipValue}>{photoCount(bars[index])}</div>
        </>
      )}
      axisLabels={() => axisLabels}
      axisLabelHalfWidth={YEAR_HALF_PX}
      width={width}
      height={height}
    />
  );
}
