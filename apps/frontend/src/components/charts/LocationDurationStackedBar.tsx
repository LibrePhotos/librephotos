import { Loader, Stack, Text, Title } from "@mantine/core";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";

import { fetchLocationTimeline } from "../../actions/utilActions";
import i18n from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../store/store";

const { Hint, XYPlot, XAxis, HorizontalBarSeries } = require("react-vis");

type HintProps = {
  y: number;
  x: number;
  loc: string;
  start: number;
  end: number;
};

export function LocationDurationStackedBar() {
  const { observe, width } = useDimensions({
    onResize: ({ observe: observeFn, unobserve: unobserveFn }) => {
      observeFn();
      unobserveFn(); // To stop observing the current target element
    },
    useBorderBoxSize: true, // Tell the hook to measure based on the border-box size, default is false
    polyfill: ResizeObserver, // Use polyfill to make this feature works on more browsers
  });
  const dispatch = useAppDispatch();
  const { locationTimeline, fetchedLocationTimeline } = useAppSelector(state => state.util);
  const [hintValue, setHintValue] = useState<HintProps>({} as HintProps);

  const { t } = useTranslation();
  useEffect(() => {
    if (!fetchedLocationTimeline) {
      fetchLocationTimeline(dispatch);
    }
  }, [dispatch, fetchedLocationTimeline]); // Only run on first render

  const getLocationFromToLabel = (loc: string | undefined, start: number | undefined, end: number | undefined) => {
    if (typeof start === "number" && typeof end === "number") {
      return t("locationstimeline.fromto", {
        location: loc,
        start: DateTime.fromSeconds(start)
          .setLocale(i18n.resolvedLanguage.replace("_", "-"))
          .toLocaleString({ year: "numeric", month: "short" }),
        end: DateTime.fromSeconds(end)
          .setLocale(i18n.resolvedLanguage.replace("_", "-"))
          .toLocaleString({ year: "numeric", month: "short" }),
      });
    }
    return null;
  };

  return (
    <Stack ref={observe}>
      <Title order={3}>{t("locationtimeline")}</Title>
      {!fetchedLocationTimeline && <Loader />}
      {locationTimeline.length === 0 && fetchedLocationTimeline && <Text color="dimmed">{t("nodata")}</Text>}
      {fetchedLocationTimeline && (
        <div>
          <XYPlot width={width - 30} height={300} stackBy="x">
            <XAxis
              tickFormat={(v: any) =>
                DateTime.fromSeconds(parseFloat(locationTimeline[0].start + v))
                  .setLocale(i18n.resolvedLanguage.replace("_", "-"))
                  .toLocaleString({ year: "numeric", month: "2-digit" })
              }
            />

            {locationTimeline.map((el: any) => (
              <HorizontalBarSeries
                key={(el.loc + el.start + el.end).toString("base64")}
                onValueMouseOver={(d: HintProps) => setHintValue(d)}
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
                <Text color="black">{getLocationFromToLabel(hintValue.loc, hintValue.start, hintValue.end)}</Text>
              </Hint>
            )}
          </XYPlot>
        </div>
      )}
    </Stack>
  );
}
