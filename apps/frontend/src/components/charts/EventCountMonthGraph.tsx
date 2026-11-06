import { BarChart } from "@mantine/charts";
import { Loader, Stack, Title } from "@mantine/core";
import { IconChartBar } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoMonthCountQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { photoMonthChart } from "./photoMonthChart";
import type { MonthBar } from "./photoMonthChart";
import classes from "./StatisticsCharts.module.css";

function isMonthBar(value: unknown): value is MonthBar {
  return (
    typeof value === "object" &&
    value !== null &&
    "key" in value &&
    typeof value.key === "string" &&
    "month" in value &&
    typeof value.month === "string" &&
    "Photos" in value &&
    typeof value.Photos === "number"
  );
}

export function EventCountMonthGraph() {
  const { t } = useTranslation();
  const monthCountsQuery = useFetchPhotoMonthCountQuery();
  const { data: photoMonthCounts, isSuccess: fetchedPhotoMonthCounts, isLoading } = monthCountsQuery;
  const listFailure = useListFailure(monthCountsQuery);

  const {
    bars: chartData,
    ticks: yearTicks,
    yearOf,
  } = photoMonthChart(fetchedPhotoMonthCounts && photoMonthCounts ? photoMonthCounts : []);

  const hasData = chartData.length > 0;

  // Recharts hands the hovered bar's chartData entry back as `payload`
  function getTooltipContent(payload: ReadonlyArray<{ payload?: unknown }> | undefined) {
    const data = payload?.[0]?.payload;
    if (!isMonthBar(data)) return null;
    return (
      <div className={classes.tooltip}>
        <div className={classes.tooltipTitle}>{data.month}</div>
        <div className={classes.tooltipValue}>{t("statistics.photocount", { count: data.Photos })}</div>
      </div>
    );
  }

  return (
    <Stack>
      <Title order={3}>{t("sidemenu.timeline")}</Title>
      {isLoading && <Loader />}
      {listFailure && <ErrorState failure={listFailure} />}
      {!isLoading && !listFailure && !hasData && (
        <EmptyState
          icon={<IconChartBar size={40} />}
          title={t("emptystate.timeline.title")}
          description={t("emptystate.timeline.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      )}
      {fetchedPhotoMonthCounts && hasData && (
        <BarChart
          h={350}
          data={chartData}
          dataKey="key"
          series={[{ name: "Photos", color: "var(--mantine-primary-color-filled)" }]}
          // Years under the bars, horizontal hairlines behind them, nothing vertical
          xAxisProps={{ ticks: yearTicks, interval: 0, tickFormatter: (key: string) => yearOf.get(key) ?? "" }}
          tickLine="none"
          gridAxis="x"
          strokeDasharray="0"
          gridColor="var(--mantine-color-default-border)"
          // Half a pixel each side of a month: bars about 4px wide over 18 years, never fat on a short span
          barChartProps={{ barCategoryGap: 0.5 }}
          maxBarWidth={16}
          barProps={{ radius: [2, 2, 0, 0] }}
          withTooltip
          tooltipAnimationDuration={200}
          // Mantine 8.3 forwards cursorFill to the DOM (React warning); the CSS variable is the same setting
          vars={() => ({ root: { "--chart-cursor-fill": "var(--mantine-primary-color-light)" } })}
          tooltipProps={{ content: ({ payload }) => getTooltipContent(payload) }}
        />
      )}
    </Stack>
  );
}
