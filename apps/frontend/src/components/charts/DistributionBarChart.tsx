import type { SearchFilters } from "@librephotos/api-client";
import { useTranslation } from "react-i18next";
import { BarChartFrame, type AxisLabel } from "./BarChartFrame";
import classes from "./StatisticsCharts.module.css";

const CHAR_PX = 6.5;
const AXIS_LABEL_GAP_PX = 10;

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

export function thinAxisLabels(texts: readonly string[], plotWidth: number): AxisLabel[] {
  const widest = Math.max(1, ...texts.map(text => text.length)) * CHAR_PX + AXIS_LABEL_GAP_PX;
  const fit = Math.max(1, Math.floor(plotWidth / widest));
  const every = Math.max(1, Math.ceil(texts.length / fit));
  return texts.flatMap((text, index) => (index % every === 0 ? [{ index, text }] : []));
}

export function DistributionBarChart({ bars, summary, onSelect, width, height }: Props) {
  const { t } = useTranslation();
  const photoCount = (bar: DistributionBar | undefined) => t("statistics.photocount", { count: bar?.count ?? 0 });
  const texts = bars.map(bar => bar.axis);
  const widest = Math.max(1, ...texts.map(text => text.length)) * CHAR_PX;

  return (
    <BarChartFrame
      counts={bars.map(bar => bar.count)}
      keyOf={index => bars[index]?.key ?? String(index)}
      summary={summary}
      barLabel={index => t("statistics.barlabel", { label: bars[index]?.name, value: photoCount(bars[index]) })}
      tooltip={index => (
        <>
          <div className={classes.tooltipTitle}>{bars[index]?.name}</div>
          <div className={classes.tooltipValue}>{photoCount(bars[index])}</div>
        </>
      )}
      axisLabels={plotWidth => thinAxisLabels(texts, plotWidth)}
      axisLabelHalfWidth={widest / 2}
      width={width}
      height={height}
      onActivate={index => {
        const bar = bars[index];
        if (bar) onSelect(bar);
      }}
    />
  );
}
