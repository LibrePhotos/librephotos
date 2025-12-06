import { IconChartBar } from "@tabler/icons-react";
import { Loader, Stack, Title, useComputedColorScheme } from "@mantine/core";
import React from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { Bars, Chart, Layer, Ticks } from "rumble-charts";

import { useFetchPhotoMonthCountQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";

export function EventCountMonthGraph() {
  const colorScheme = useComputedColorScheme();
  const { t } = useTranslation();
  const { observe: observeChange, width } = useDimensions({
    onResize: ({ observe, unobserve }) => {
      observe();
      unobserve(); // To stop observing the current target element
    },
  });
  const { data: photoMonthCounts, isSuccess: fetchedPhotoMonthCounts, isLoading } = useFetchPhotoMonthCountQuery();

  let series: Array<{ y: number; month: string }> = [];
  let xticks: Array<string> = [];
  if (fetchedPhotoMonthCounts && photoMonthCounts) {
    const countDict = photoMonthCounts;
    series = countDict.map((el: any) => ({ y: el.count, month: el.month }));
    xticks = countDict.map((el: any) => el.month);
  }

  const hasData = series.length > 0;

  const data = [
    {
      data: series,
    },
    {
      data: [0, 1, 2],
    },
  ];

  return (
    <Stack ref={observeChange}>
      <Title order={3}>Monthly Photo Counts</Title>
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
      {fetchedPhotoMonthCounts && hasData && width > 0 && (
        <div>
          <Chart width={width} height={300} series={[data[0]]}>
            <Layer width="85%" height="85%" position="middle center">
              <Ticks
                axis="y"
                lineLength="100%"
                lineVisible
                lineStyle={{ stroke: "lightgray" }}
                labelStyle={{
                  textAnchor: "end",
                  dominantBaseline: "middle",
                  fill: colorScheme === "dark" ? "grey" : "black",
                }}
                labelAttributes={{ x: -15 }}
                labelFormat={(label: any) => label}
              />
              <Ticks
                lineVisible
                lineLength="100%"
                axis="x"
                labelFormat={(label: any) => xticks[label]}
                labelStyle={{
                  textAnchor: "middle",
                  dominantBaseline: "text-before-edge",
                  fill: colorScheme === "dark" ? "grey" : "black",
                }}
                labelAttributes={{ y: 5 }}
              />
              <Bars />
            </Layer>
          </Chart>
        </div>
      )}
    </Stack>
  );
}
