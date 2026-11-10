import { Loader, Stack, Title, useComputedColorScheme } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { IconMapPin } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useLocationTimelineQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { locationTimelineChart } from "./locationTimelineChart";
import classes from "./StatisticsCharts.module.css";
import { StayBarChart } from "./StayBarChart";

export function LocationDurationStackedBar() {
  const timelineQuery = useLocationTimelineQuery();
  const { data: locationTimeline = [], isSuccess: fetchedLocationTimeline, isLoading } = timelineQuery;
  const listFailure = useListFailure(timelineQuery);
  const { t } = useTranslation();
  const { ref: plotRef, width, height } = useElementSize<HTMLDivElement>();

  const scheme = useComputedColorScheme("light");
  const { series, legend } = locationTimelineChart(fetchedLocationTimeline ? locationTimeline : [], scheme);

  return (
    <Stack>
      <Title order={3}>{t("locationtimeline")}</Title>
      {isLoading && <Loader />}
      {listFailure && <ErrorState failure={listFailure} />}
      {locationTimeline.length === 0 && fetchedLocationTimeline && !isLoading && (
        <EmptyState
          icon={<IconMapPin size={40} />}
          title={t("emptystate.places.title")}
          description={t("emptystate.places.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      )}
      {fetchedLocationTimeline && locationTimeline.length > 0 && (
        <>
          <div ref={plotRef} className={classes.stayPlot}>
            {width > 0 && (
              <StayBarChart
                stays={locationTimeline}
                colors={series.map(entry => entry.color)}
                width={width}
                height={height}
              />
            )}
          </div>
          {/* One entry per place in the bar's order, the places past the tints as "Other" */}
          <div className={classes.legend}>
            {legend.map(entry => {
              const swatch = { backgroundColor: entry.color };
              return (
                <div key={entry.label ?? ""} className={classes.legendItem}>
                  <span className={classes.swatch} style={swatch} />
                  <span>{entry.label ?? t("statistics.otherplaces")}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Stack>
  );
}
