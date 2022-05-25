import { Title } from "@mantine/core";
import React from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";

import { useAppSelector } from "../../store/store";

const { Chart, Transform, Cloud } = require("rumble-charts");

type Props = {
  type: string;
  height: number;
};

export function WordCloud(props: Props) {
  const { observe, unobserve, width } = useDimensions({
    onResize: ({ observe, unobserve, width, height, entry }) => {
      observe();
    },
    useBorderBoxSize: true, // Tell the hook to measure based on the border-box size, default is false
    polyfill: ResizeObserver, // Use polyfill to make this feature works on more browsers);
  });
  const { height } = props;
  const { wordCloud, fetchedWordCloud } = useAppSelector(state => state.util);
  const { t } = useTranslation();

  const title = () => {
    let title = t("people");
    if (props.type === "captions") {
      title = t("things");
    }
    if (props.type === "location") {
      title = t("places");
    }
    return title;
  };

  const series = () => {
    if (fetchedWordCloud) {
      if (props.type === "people") {
        return [{ data: wordCloud.people }];
      }
      if (props.type === "captions") {
        return [{ data: wordCloud.captions }];
      }
      if (props.type === "location") {
        return [{ data: wordCloud.locations }];
      }
    }
    return [];
  };
  return (
    <div ref={observe}>
      <Title order={3}>{title()}</Title>
      <Chart width={width - 50} height={height - 70} series={series()}>
        <Transform method={["transpose"]}>
          <Cloud font="sans-serif" minFontsSize={10} maxFontSize={50} random={() => 1} />
        </Transform>
      </Chart>
    </div>
  );
}

export default WordCloud;
