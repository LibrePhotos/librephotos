import { Loader, Stack, Title, useMantineColorScheme } from "@mantine/core";
import React, { useEffect } from "react";
import useDimensions from "react-cool-dimensions";

import { fetchPhotoMonthCounts } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

const { Chart, Bars, Ticks, Layer } = require("rumble-charts");

export function EventCountMonthGraph() {
  const { colorScheme } = useMantineColorScheme();

  const { observe, width } = useDimensions({
    onResize: ({ observe, unobserve, width, height, entry }) => {
      observe();
      unobserve(); // To stop observing the current target element
    },
  });
  const dispatch = useAppDispatch();
  const { photoMonthCounts, fetchingPhotoMonthCounts, fetchedPhotoMonthCounts } = useAppSelector(state => state.util);

  useEffect(() => {
    if (!fetchedPhotoMonthCounts) {
      fetchPhotoMonthCounts(dispatch);
    }
  }, [dispatch]); // Only run on first render

  if (fetchedPhotoMonthCounts) {
    const countDict = photoMonthCounts;
    var series = countDict.map((el: any) => ({ y: el.count, month: el.month }));
    var xticks = countDict.map((el: any) => el.month);
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
    <Stack ref={observe}>
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

export default EventCountMonthGraph;
