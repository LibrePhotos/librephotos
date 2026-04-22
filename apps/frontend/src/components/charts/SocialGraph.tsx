import { Group, Loader, Text, useComputedColorScheme } from "@mantine/core";
import { IconShare } from "@tabler/icons-react";
import * as d3 from "d3";
import React, { useCallback, useEffect, useRef } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { useFetchSocialGraphQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";

type Props = Readonly<{
  height: number;
}>;

function ForceGraph({
  data,
  width,
  height,
}: {
  data: { nodes: { id: string; x: number; y: number }[]; links: { source: string; target: string }[] };
  width: number;
  height: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const colorScheme = useComputedColorScheme();

  const renderGraph = useCallback(() => {
    if (!svgRef.current || !data || width <= 0 || height <= 0) return undefined;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", event => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    const nodes = data.nodes.map(d => ({ ...d }));
    const links = data.links.map(d => ({ ...d }));

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance(100)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(30));

    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#12939A")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.6);

    const node = g
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 12)
      .attr("fill", "lightblue")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .call(
        d3
          .drag<SVGCircleElement, any>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            /* eslint-disable no-param-reassign -- d3-force requires mutating node properties */
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
            /* eslint-enable no-param-reassign */
          })
      );

    node
      .on("mouseover", function () {
        d3.select(this).attr("stroke", "orange").attr("stroke-width", 3);
      })
      .on("mouseout", function () {
        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 1.5);
      });

    const label = g
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text(d => d.id)
      .attr("font-size", 10)
      .attr("fill", colorScheme === "dark" ? "white" : "black")
      .attr("text-anchor", "middle")
      .attr("dy", -18);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
      label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
    });

    return () => {
      simulation.stop();
    };
  }, [data, width, height, colorScheme]);

  useEffect(() => {
    const cleanup = renderGraph();
    return () => cleanup?.();
  }, [renderGraph]);

  return <svg ref={svgRef} width={width} height={height} />;
}

export function SocialGraph({ height }: Props) {
  const { data, isFetching, isSuccess } = useFetchSocialGraphQuery();
  const { observe: observeChange, width } = useDimensions({ onResize: ({ observe }) => observe() });
  const { t } = useTranslation();

  let graph: React.JSX.Element;
  if (isSuccess && data.nodes.length > 0) {
    graph = <ForceGraph data={data} width={width} height={height} />;
  } else if (isFetching) {
    graph = (
      <Group>
        <Loader />
        <Text>{t("fetchingsocialgraph")}</Text>
      </Group>
    );
  } else {
    graph = (
      <EmptyState
        icon={<IconShare size={40} />}
        title={t("emptystate.socialgraph.title")}
        description={t("emptystate.socialgraph.description")}
        actionLabel={t("emptystate.goToFaces")}
        actionLink="/faces"
      />
    );
  }
  return <div ref={observeChange}>{graph}</div>;
}
