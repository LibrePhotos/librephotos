import { Loader, Stack, Text, Title } from "@mantine/core";
import { DateTime } from "luxon";
import React, { useState } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { Hint, HorizontalBarSeries, XAxis, XYPlot } from "react-vis";

import { useLocationTimelineQuery } from "../../api_client/location-timeline";
import { i18nResolvedLanguage } from "../../i18n";

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
  const { data: locationTimeline = [], isSuccess: fetchedLocationTimeline } = useLocationTimelineQuery();
  const [hintValue, setHintValue] = useState<HintProps>({} as HintProps);
  const { t } = useTranslation();

  const getLocationFromToLabel = (loc: string | undefined, start: number | undefined, end: number | undefined) => {
    if (typeof start === "number" && typeof end === "number") {
      return t("locationstimeline.fromto", {
        location: loc,
        start: DateTime.fromSeconds(start)
          .setLocale(i18nResolvedLanguage())
          .toLocaleString({ year: "numeric", month: "short" }),
        end: DateTime.fromSeconds(end)
          .setLocale(i18nResolvedLanguage())
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
                  .setLocale(i18nResolvedLanguage())
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
