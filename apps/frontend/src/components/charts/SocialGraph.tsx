import { Group, Loader, Text, useMantineColorScheme } from "@mantine/core";
import React, { useEffect } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";

import { fetchSocialGraph } from "../../actions/peopleActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

const { Graph } = require("react-d3-graph");

type Props = {
  height: number;
};

export function SocialGraph(props: Props) {
  const { colorScheme } = useMantineColorScheme();
  const { observe: observeChange, width } = useDimensions({
    onResize: ({ observe }) => {
      observe();
    },
  });

  const dispatch = useAppDispatch();
  const { socialGraph, fetchedSocialGraph, fetchingSocialGraph } = useAppSelector(state => state.people);

  const { t } = useTranslation();

  useEffect(() => {
    if (!fetchedSocialGraph) {
      fetchSocialGraph(dispatch);
    }
  }, [dispatch]); // Only run on first render

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
    height: props.height,
    width,
  };
  let graph;
  if (fetchedSocialGraph && socialGraph.nodes.length > 0) {
    graph = <Graph id="social-graph" config={myConfig} data={socialGraph} />;
  } else {
    if (fetchingSocialGraph) {
      // To-Do: This doesn't show up for some reason
      graph = (
        <Group>
          <Loader />
          <Text>{t("fetchingsocialgraph")}</Text>
        </Group>
      );
    }
    graph = <Text>{t("nosocialgraph")}</Text>;
  }
  return <div ref={observeChange}>{graph}</div>;
}

export default SocialGraph;
