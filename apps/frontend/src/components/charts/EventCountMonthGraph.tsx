import { Loader, Stack, Title, useMantineColorScheme } from "@mantine/core";
import React from "react";
import useDimensions from "react-cool-dimensions";
import { Bars, Chart, Layer, Ticks } from "rumble-charts";

import { useFetchPhotoMonthCountQuery } from "../../api_client/util";

export function EventCountMonthGraph() {
  const { colorScheme } = useMantineColorScheme();
  const { observe: observeChange, width } = useDimensions({
    onResize: ({ observe, unobserve }) => {
      observe();
      unobserve(); // To stop observing the current target element
    },
  });
  const { data: photoMonthCounts, isSuccess: fetchedPhotoMonthCounts } = useFetchPhotoMonthCountQuery();

  let series: Array<{ y: number; month: string }> = [];
  let xticks: Array<string> = [];
  if (fetchedPhotoMonthCounts) {
    const countDict = photoMonthCounts;
    series = countDict.map((el: any) => ({ y: el.count, month: el.month }));
    xticks = countDict.map((el: any) => el.month);
  }

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
      {!fetchedPhotoMonthCounts && <Loader />}
      {fetchedPhotoMonthCounts && width > 0 && (
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
