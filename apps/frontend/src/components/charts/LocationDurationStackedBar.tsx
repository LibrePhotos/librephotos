import { BarChart } from "@mantine/charts";
import { Loader, Stack, Title } from "@mantine/core";
import { IconMapPin } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocationTimelineQuery } from "../../api_client/stats/hooks";
import { fromUnixSeconds } from "../../util/dateUtils";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { locationTimelineChart, stayForSeries } from "./locationTimelineChart";
import classes from "./StatisticsCharts.module.css";

export function LocationDurationStackedBar() {
  const timelineQuery = useLocationTimelineQuery();
  const { data: locationTimeline = [], isSuccess: fetchedLocationTimeline, isLoading } = timelineQuery;
  const listFailure = useListFailure(timelineQuery);
  const { t } = useTranslation();
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  const { data: chartData, series, legend } = locationTimelineChart(fetchedLocationTimeline ? locationTimeline : []);

  function getTooltipContent(active?: boolean) {
    if (!active || !hoveredSegment) return null;

    const locData = stayForSeries(locationTimeline, hoveredSegment);
    if (!locData) return null;

    // The place's colour, as the bar and the legend show it
    const swatch = { backgroundColor: series.find(entry => entry.name === hoveredSegment)?.color };
    const startDate = fromUnixSeconds(locData.start).toLocaleString({ year: "numeric", month: "short" });
    const endDate = fromUnixSeconds(locData.end).toLocaleString({ year: "numeric", month: "short" });

    return (
      <div className={classes.tooltip}>
        <div className={classes.tooltipTitle}>
          <span className={classes.swatch} style={swatch} />
          {locData.loc}
        </div>
        <div className={classes.tooltipValue}>
          {startDate} – {endDate}
        </div>
      </div>
    );
  }

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
          <BarChart
            h={80}
            data={chartData}
            dataKey="label"
            orientation="vertical"
            type="stacked"
            series={series}
            withYAxis={false}
            withXAxis={false}
            // Without a domain the hidden value axis rounds up to a "nice"
            // tick and the bar stopped short of the right edge.
            xAxisProps={{ domain: [0, "dataMax"] }}
            gridAxis="none"
            // One <Bar> per series, so the hovered segment is the series the
            // props were built for. Recharts 3 no longer passes the
            // tooltipPayload this used to read the name from.
            barProps={segment => ({
              radius: 2,
              onMouseMove: () => {
                if (segment.name !== hoveredSegment) {
                  setHoveredSegment(segment.name);
                }
              },
              onMouseLeave: () => setHoveredSegment(null),
            })}
            tooltipAnimationDuration={200}
            // Mantine 8.3 forwards cursorFill to the DOM (React warning); the CSS variable is the same setting
            vars={() => ({ root: { "--chart-cursor-fill": "var(--mantine-color-gray-light)" } })}
            tooltipProps={{ content: ({ active }) => getTooltipContent(active) }}
          />
          {/* One entry per place, the places past the palette as "Other" */}
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
