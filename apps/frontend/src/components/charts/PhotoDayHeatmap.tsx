import { Group, Loader, Select, Stack, Title } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { IconChartBar } from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoDayCountQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { DayHeatmap } from "./DayHeatmap";
import { dayHeatmap, photoYears } from "./dayHeatmapGrid";
import classes from "./StatisticsCharts.module.css";

export function PhotoDayHeatmap() {
  const { t } = useTranslation();
  const dayCountsQuery = useFetchPhotoDayCountQuery();
  const { data: photoDayCounts, isSuccess: fetchedPhotoDayCounts, isLoading } = dayCountsQuery;
  const listFailure = useListFailure(dayCountsQuery);
  const { ref: plotRef, width } = useElementSize<HTMLDivElement>();
  const [chosenYear, setChosenYear] = useState<number | null>(null);

  const counts = useMemo(
    () => (fetchedPhotoDayCounts && photoDayCounts ? photoDayCounts : []),
    [fetchedPhotoDayCounts, photoDayCounts]
  );
  const years = useMemo(() => photoYears(counts), [counts]);
  const year = chosenYear !== null && years.includes(chosenYear) ? chosenYear : years[0];
  const grid = useMemo(() => (year === undefined ? null : dayHeatmap(counts, year)), [counts, year]);
  const hasData = years.length > 0;

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Title order={3}>{t("statistics.photosperday")}</Title>
        {hasData && year !== undefined && (
          <Select
            size="xs"
            w={96}
            aria-label={t("statistics.dayheatmapyear")}
            value={String(year)}
            data={years.map(String)}
            allowDeselect={false}
            withCheckIcon={false}
            onChange={value => {
              if (value !== null) setChosenYear(Number(value));
            }}
          />
        )}
      </Group>
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
          {width > 0 && grid && <DayHeatmap key={year} grid={grid} width={width} />}
        </div>
      )}
    </Stack>
  );
}
