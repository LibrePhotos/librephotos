import { IconCloud } from "@tabler/icons-react";
import { Loader, Title } from "@mantine/core";
import React from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { Chart, Cloud, Transform } from "rumble-charts";

import { useFetchWordCloudQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";

type Props = Readonly<{
  type: string;
  height: number;
}>;

export function WordCloud(props: Props) {
  const { observe: observeChange, width } = useDimensions({
    onResize: ({ observe }) => {
      observe();
    },
    useBorderBoxSize: true, // Tell the hook to measure based on the border-box size, default is false
    polyfill: ResizeObserver, // Use polyfill to make this feature works on more browsers);
  });
  const { height } = props;
  const { data: wordCloud, isLoading } = useFetchWordCloudQuery();
  const { t } = useTranslation();

  const title = () => {
    const { type } = props;
    let result = t("people");
    if (type === "captions") {
      result = t("things");
    }
    if (type === "location") {
      result = t("places");
    }
    return result;
  };

  const series = () => {
    const { type } = props;
    if (wordCloud) {
      if (type === "people") {
        return [{ data: wordCloud.people }];
      }
      if (type === "captions") {
        return [{ data: wordCloud.captions }];
      }
      if (type === "location") {
        return [{ data: wordCloud.locations }];
      }
    }
    return [];
  };

  const hasData = () => {
    const seriesData = series();
    return seriesData.length > 0 && seriesData[0].data && seriesData[0].data.length > 0;
  };

  if (isLoading) {
    return <Loader />;
  }

  if (!wordCloud || !hasData()) {
    return (
      <div ref={observeChange}>
        <Title order={3}>{title()}</Title>
        <EmptyState
          icon={<IconCloud size={40} />}
          title={t("emptystate.wordcloud.title")}
          description={t("emptystate.wordcloud.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      </div>
    );
  }

  return (
    <div ref={observeChange}>
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
