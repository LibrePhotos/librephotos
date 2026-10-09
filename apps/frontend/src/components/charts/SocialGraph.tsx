import { Group, Loader, Text, useComputedColorScheme } from "@mantine/core";
import { IconShare } from "@tabler/icons-react";
import { drag } from "d3-drag";
import type { D3DragEvent, SubjectPosition } from "d3-drag";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { SimulationNodeDatum } from "d3-force";
import { select } from "d3-selection";
import { zoom as d3Zoom } from "d3-zoom";
import type { D3ZoomEvent } from "d3-zoom";
import React, { useCallback, useEffect, useRef } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { useFetchSocialGraphQuery } from "../../api_client/stats/hooks";
import type { PersonDataPointList } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";

type Props = Readonly<{
  height: number;
}>;

type GraphNode = SimulationNodeDatum & { id: string };
/** forceLink swaps each end's node id for the node itself when the simulation starts. */
type GraphLink = { source: string | GraphNode; target: string | GraphNode };

// The events d3 passes the listeners below: the @types/d3-* listener signatures leave the event untyped.
// The zoom has no datum; a drag's subject is the dragged node, d3's default subject.
type ZoomEvent = D3ZoomEvent<SVGSVGElement, unknown>;
type NodeDragEvent = D3DragEvent<SVGCircleElement, GraphNode, GraphNode | SubjectPosition>;

// By the first tick the ends are nodes the simulation has placed. null, like the
// undefined it stands in for, makes d3 leave the attribute out.
const endPosition = (end: GraphLink["source"], axis: "x" | "y") =>
  typeof end === "string" ? null : (end[axis] ?? null);

function ForceGraph({ data, width, height }: { data: PersonDataPointList; width: number; height: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const colorScheme = useComputedColorScheme();

  const renderGraph = useCallback(() => {
    if (!svgRef.current || !data || width <= 0 || height <= 0) return undefined;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g");

    const zoom = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event: ZoomEvent) => {
        // What setAttribute would make of the transform object anyway
        g.attr("transform", event.transform.toString());
      });

    svg.call(zoom);

    const nodes: GraphNode[] = data.nodes.map(d => ({ ...d }));
    const links: GraphLink[] = data.links.map(d => ({ ...d }));

    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id(d => d.id)
          .distance(100)
      )
      .force("charge", forceManyBody().strength(-300))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collision", forceCollide().radius(30));

    const link = g
      .append("g")
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "#12939A")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.6);

    // join() types its result as what selectAll found plus what it creates, and drag()
    // takes only circles, so selectAll names the element type
    const node = g
      .append("g")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 12)
      .attr("fill", "lightblue")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .call(
        drag<SVGCircleElement, GraphNode>()
          .on("start", (event: NodeDragEvent, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            /* eslint-disable no-param-reassign -- d3-force requires mutating node properties */
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event: NodeDragEvent, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event: NodeDragEvent, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
            /* eslint-enable no-param-reassign */
          })
      );

    node
      .on("mouseover", function () {
        select(this).attr("stroke", "orange").attr("stroke-width", 3);
      })
      .on("mouseout", function () {
        select(this).attr("stroke", "#fff").attr("stroke-width", 1.5);
      });

    const label = g
      .append("g")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(nodes)
      .join("text")
      .text(d => d.id)
      .attr("font-size", 10)
      .attr("fill", colorScheme === "dark" ? "white" : "black")
      .attr("text-anchor", "middle")
      .attr("dy", -18);

    simulation.on("tick", () => {
      link
        .attr("x1", d => endPosition(d.source, "x"))
        .attr("y1", d => endPosition(d.source, "y"))
        .attr("x2", d => endPosition(d.target, "x"))
        .attr("y2", d => endPosition(d.target, "y"));
      node.attr("cx", d => d.x ?? null).attr("cy", d => d.y ?? null);
      label.attr("x", d => d.x ?? null).attr("y", d => d.y ?? null);
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
