import { Loader, Text, Title } from "@mantine/core";
import moment from "moment";
import React, { useEffect, useState } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";

import { fetchLocationTimeline } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

const { Hint, XYPlot, XAxis, HorizontalBarSeries } = require("react-vis");

type Hint = {
  y: number;
  x: number;
  loc: String;
  start: number;
  end: number;
};

export function LocationDurationStackedBar() {
  const { observe, width } = useDimensions({
    onResize: ({ observe, unobserve, width, height, entry }) => {
      observe();
      unobserve(); // To stop observing the current target element
    },
    useBorderBoxSize: true, // Tell the hook to measure based on the border-box size, default is false
    polyfill: ResizeObserver, // Use polyfill to make this feature works on more browsers);
  });
  const dispatch = useAppDispatch();
  const { locationTimeline, fetchingLocationTimeline, fetchedLocationTimeline } = useAppSelector(state => state.util);
  const [hintValue, setHintValue] = useState<Hint>({} as Hint);

  const { t } = useTranslation();
  useEffect(() => {
    if (!fetchedLocationTimeline) {
      fetchLocationTimeline(dispatch);
    }
  }, [dispatch]); // Only run on first render

  if (fetchedLocationTimeline) {
    return (
      <div style={{ height: 280 }}>
        <Title order={3}>{t("locationtimeline")}</Title>
        <div>
          <XYPlot width={width - 30} height={300} stackBy="x">
            <XAxis tickFormat={(v: any) => moment.unix(locationTimeline[0].start + v).format("YYYY-MM")} />

            {locationTimeline.map((el: any) => (
              <HorizontalBarSeries
                onValueMouseOver={(d: any, info: any) => {
                  setHintValue(d);
                }}
                style={{ fill: el.color, stroke: el.color }}
                data={[
                  {
                    y: 1,
                    x: el.data[0],
                    loc: el.loc,
                    start: el.start,
                    end: el.end,
                  },
                ]}
              />
            ))}

            {hintValue && (
              <Hint value={hintValue}>
                <Text>
                  {hintValue.loc}
                  {` from ${moment.unix(hintValue.start).format("YYYY-MM-DD")} to ${moment
                    .unix(hintValue.end)
                    .format("YYYY-MM-DD")}`}
                </Text>
              </Hint>
            )}
          </XYPlot>
        </div>
      </div>
    );
  }
  if (fetchingLocationTimeline) {
    return (
      <div style={{ height: 280 }}>
        <Title order={3}>{t("locationtimeline")}</Title>
        <Loader />
      </div>
    );
  }
  return (
    <div style={{ height: 280 }}>
      <Title order={3}>{t("locationtimeline")}</Title>
      <Text>{t("nodata")}</Text>
    </div>
  );
}

export default LocationDurationStackedBar;
