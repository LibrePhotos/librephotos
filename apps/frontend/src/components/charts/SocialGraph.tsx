import { Group, Loader, Text, useMantineColorScheme } from "@mantine/core";
import React from "react";
import useDimensions from "react-cool-dimensions";
import { Graph } from "react-d3-graph";
import { useTranslation } from "react-i18next";

import { useFetchSocialGraphQuery } from "../../api_client/people";

type Props = Readonly<{
  height: number;
}>;

export function SocialGraph({ height }: Props) {
  const { colorScheme } = useMantineColorScheme();
  const { data, isFetching, isSuccess } = useFetchSocialGraphQuery();
  const { observe: observeChange, width } = useDimensions({ onResize: ({ observe }) => observe() });
  const { t } = useTranslation();

  const myConfig = {
    automaticRearrangeAfterDropNode: false,
    staticGraph: true,
    nodeHighlightBehavior: true,
    maxZoom: 4,
    minZoom: 0.1,
    node: {
      fontSize: 10,
      fontColor: colorScheme === "dark" ? "white" : "black",
      size: 500,
      color: "lightblue",
      highlightFontSize: 15,
      highlightStrokeColor: "orange",
    },
    link: {
      highlightColor: "orange",
      color: "#12939A",
    },
    height,
    width,
  };
  let graph: React.JSX.Element;
  if (isSuccess && data.nodes.length > 0) {
    graph = <Graph id="social-graph" config={myConfig} data={data} />;
  } else if (isFetching) {
    graph = (
      <Group>
        <Loader />
        <Text>{t("fetchingsocialgraph")}</Text>
      </Group>
    );
  } else {
    graph = <Text>{t("nosocialgraph")}</Text>;
  }
  return <div ref={observeChange}>{graph}</div>;
}
