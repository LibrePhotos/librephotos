import { Loader, Stack, Title } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { IconChartBar } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoDayCountQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { DayHeatmap } from "./DayHeatmap";
import { dayHeatmap, weeksForWidth } from "./dayHeatmap";
import classes from "./StatisticsCharts.module.css";

export function PhotoDayHeatmap() {
  const { t } = useTranslation();
  const dayCountsQuery = useFetchPhotoDayCountQuery();
  const { data: photoDayCounts, isSuccess: fetchedPhotoDayCounts, isLoading } = dayCountsQuery;
  const listFailure = useListFailure(dayCountsQuery);
  const { ref: plotRef, width } = useElementSize<HTMLDivElement>();

  const counts = fetchedPhotoDayCounts && photoDayCounts ? photoDayCounts : [];
  const grid = dayHeatmap(counts, weeksForWidth(width));
  const hasData = counts.length > 0;

  return (
    <Stack gap="sm">
      <Title order={3}>{t("statistics.photosperday")}</Title>
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
      {fetchedPhotoDayCounts && hasData && (
        <div ref={plotRef} className={classes.dayPlot}>
          {width > 0 && <DayHeatmap grid={grid} width={width} />}
        </div>
      )}
    </Stack>
  );
}
