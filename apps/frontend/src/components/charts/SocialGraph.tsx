import React, { useEffect } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { Loader } from "semantic-ui-react";

import { fetchSocialGraph } from "../../actions/peopleActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

const { Graph } = require("react-d3-graph");

type Props = {
  height: number;
};
export function SocialGraph(props: Props) {
  const { observe, width } = useDimensions({
    onResize: ({ observe, unobserve, width, height, entry }) => {
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
    width: width,
  };
  let graph;
  if (fetchedSocialGraph && socialGraph.nodes.length > 0) {
    graph = <Graph id="social-graph" config={myConfig} data={socialGraph} />;
  } else {
    if (fetchingSocialGraph) {
      // To-Do: This doesn't show up for some reason
      graph = <Loader active>{t("fetchingsocialgraph")}</Loader>;
    }
    graph = <p>{t("nosocialgraph")}</p>;
  }
  return <div ref={observe}>{graph}</div>;
}

export default SocialGraph;
