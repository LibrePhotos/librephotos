import { BarChart } from "@mantine/charts";
import { Loader, Stack, Title } from "@mantine/core";
import { IconChartBar } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoMonthCountQuery } from "../../api_client/stats/hooks";
import { i18nResolvedLanguage } from "../../i18n";
import { EmptyState } from "../common/EmptyState";

export function EventCountMonthGraph() {
  const { t } = useTranslation();
  const { data: photoMonthCounts, isSuccess: fetchedPhotoMonthCounts, isLoading } = useFetchPhotoMonthCountQuery();

  const chartData =
    fetchedPhotoMonthCounts && photoMonthCounts
      ? photoMonthCounts.map((el: { count: number; month: string }) => {
          // Parse the month string (format: "YYYY-M") and format by locale
          const [year, month] = el.month.split("-");
          const date = DateTime.fromObject({ year: parseInt(year, 10), month: parseInt(month, 10) });
          const formattedMonth = date
            .setLocale(i18nResolvedLanguage())
            .toLocaleString({ year: "2-digit", month: "short" });

          return {
            month: formattedMonth,
            Photos: el.count,
          };
        })
      : [];

  const hasData = chartData.length > 0;

  function getTooltipContent(payload: any[]) {
    if (!payload || payload.length === 0) return null;
    const data = payload[0].payload;
    return (
      <div
        style={{
          background: "var(--mantine-color-body)",
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: "var(--mantine-radius-sm)",
          padding: "8px 12px",
          boxShadow: "var(--mantine-shadow-md)",
        }}
      >
        <div style={{ fontWeight: 500, marginBottom: 4 }}>{data.month}</div>
        <div style={{ color: "var(--mantine-color-blue-6)" }}>
          {data.Photos} {t("photos.photos")}
        </div>
      </div>
    );
  }

  return (
    <Stack>
      <Title order={3}>{t("sidemenu.timeline")}</Title>
      {isLoading && <Loader />}
      {!isLoading && !hasData && (
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
          dataKey="month"
          series={[{ name: "Photos", color: "blue.6" }]}
          tickLine="y"
          gridAxis="y"
          withTooltip
          tooltipAnimationDuration={200}
          cursorFill="var(--mantine-color-blue-light)"
          tooltipProps={{ content: ({ payload }) => getTooltipContent(payload) }}
        />
      )}
    </Stack>
  );
}
