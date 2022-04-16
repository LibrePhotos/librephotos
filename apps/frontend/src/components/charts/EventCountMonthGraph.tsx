import React, { useEffect } from "react";
import useDimensions from "react-cool-dimensions";
import { Header, Loader, Segment } from "semantic-ui-react";

import { fetchPhotoMonthCounts } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

const { Chart, Bars, Ticks, Layer } = require("rumble-charts");

export function EventCountMonthGraph() {
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
  } else {
    return (
      <div style={{ height: 280 }}>
        <Header as="h3">Monthly Photo Counts</Header>
        <Segment style={{ height: 250 }} basic>
          <Loader active />
        </Segment>
      </div>
    );
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
    <div ref={observe} style={{ height: 280 }}>
      <Header as="h3">Monthly Photo Counts</Header>
      <div>
        <Chart width={width} height={250} series={[data[0]]}>
          <Layer width="85%" height="85%" position="middle center">
            <Ticks
              axis="y"
              lineLength="100%"
              lineVisible
              lineStyle={{ stroke: "lightgray" }}
              labelStyle={{
                textAnchor: "end",
                dominantBaseline: "middle",
                fill: "grey",
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
                fill: "black",
              }}
              labelAttributes={{ y: 5 }}
            />
            <Bars />
          </Layer>
        </Chart>
      </div>
    </div>
  );
}

export default EventCountMonthGraph;
