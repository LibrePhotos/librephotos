import { Loader, Stack, Title } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { IconChartBar } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoMonthCountQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { MonthBarChart } from "./MonthBarChart";
import { photoMonthChart } from "./photoMonthChart";
import classes from "./StatisticsCharts.module.css";

export function EventCountMonthGraph() {
  const { t } = useTranslation();
  const monthCountsQuery = useFetchPhotoMonthCountQuery();
  const { data: photoMonthCounts, isSuccess: fetchedPhotoMonthCounts, isLoading } = monthCountsQuery;
  const listFailure = useListFailure(monthCountsQuery);
  // The bars are months, quarters or years, whichever keeps them at least 6px wide on this width
  const { ref: plotRef, width, height } = useElementSize<HTMLDivElement>();

  const counts = fetchedPhotoMonthCounts && photoMonthCounts ? photoMonthCounts : [];
  const { bars, ticks, yearOf } = photoMonthChart(counts, width);

  const hasData = bars.length > 0;

  return (
    <Stack gap="sm">
      <Title order={3}>{t("statistics.photospermonth")}</Title>
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
        // Measured first, drawn once the width is known, so the bars never start as needles
        <div ref={plotRef} className={classes.timelinePlot}>
          {width > 0 && <MonthBarChart bars={bars} ticks={ticks} yearOf={yearOf} width={width} height={height} />}
        </div>
      )}
    </Stack>
  );
}
