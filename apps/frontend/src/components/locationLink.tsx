import { Group, NativeSelect, Button } from "@mantine/core";
import { LinearGradient } from "@visx/gradient";
import { Group as VisxGroup } from "@visx/group";
import { Tree } from "@visx/hierarchy";
import {
  LinkHorizontal,
  LinkHorizontalCurve,
  LinkHorizontalLine,
  LinkHorizontalStep,
  LinkRadial,
  LinkRadialCurve,
  LinkRadialLine,
  LinkRadialStep,
  LinkVertical,
  LinkVerticalCurve,
  LinkVerticalLine,
  LinkVerticalStep,
} from "@visx/shape";
import { hierarchy } from "d3-hierarchy";
import { pointRadial } from "d3-shape";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { useViewportSize } from "@mantine/hooks";

import { useFetchLocationTreeQuery } from "../api_client/stats/hooks";

type NodeData = {
  name: string;
  value?: number;
  children?: NodeData[];
  isExpanded?: boolean;
  hex?: string;
};

type Props = Readonly<{
  margin?: {
    top: number;
    left: number;
    right: number;
    bottom: number;
  };
}>;

const STEP_PERCENT = 0.5;
const ZOOM_STEP = 0.1;
const HEADER_HEIGHT = 200; // Approximate height of the header and controls
const RECT_WIDTH = 120;
const RECT_HEIGHT = 30;
const SVG_PADDING = 100;

export function LocationLink({
  margin = { top: 0, left: 0, right: 0, bottom: 0 },
}: Props) {
  const { height: viewportHeight } = useViewportSize();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 750, height: 750 });
  const [layout, setLayout] = useState("cartesian");
  const [orientation, setOrientation] = useState("horizontal");
  const [linkType, setLinkType] = useState("diagonal");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const { data: locationSunburst, isLoading } = useFetchLocationTreeQuery();

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width } = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: width - 40, // 20px padding on each side
          height: viewportHeight - HEADER_HEIGHT,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [viewportHeight]);

  const { width, height } = dimensions;
  const innerWidth = width - margin.left - margin.right - (2 * SVG_PADDING);
  const innerHeight = height - margin.top - margin.bottom - (2 * SVG_PADDING);

  let origin: { x: number; y: number };
  let sizeWidth: number;
  let sizeHeight: number;

  if (layout === "polar") {
    origin = {
      x: innerWidth / 2,
      y: innerHeight / 2,
    };
    sizeWidth = 2 * Math.PI;
    sizeHeight = Math.min(innerWidth, innerHeight) / 2;
  } else {
    origin = { x: SVG_PADDING, y: SVG_PADDING };
    if (orientation === "vertical") {
      sizeWidth = innerWidth;
      sizeHeight = innerHeight;
    } else {
      sizeWidth = innerHeight;
      sizeHeight = innerWidth;
    }
  }

  const handleNodeClick = useCallback((node: any) => {
    const nodePath = node.data.name;
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodePath)) {
        newSet.delete(nodePath);
      } else {
        newSet.add(nodePath);
      }
      return newSet;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + ZOOM_STEP, 2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - ZOOM_STEP, 0.5));
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handlePan = useCallback((e: React.MouseEvent) => {
    if (e.buttons === 1) { // Left mouse button
      setTranslate(prev => ({
        x: prev.x + e.movementX,
        y: prev.y + e.movementY,
      }));
    }
  }, []);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const processData = (data: NodeData): NodeData => {
    const processed = { ...data };
    if (processed.children) {
      processed.isExpanded = expandedNodes.has(processed.name);
      processed.children = processed.children.map(child => processData(child));
    }
    return processed;
  };

  const processedData = processData(locationSunburst);

  return (
    <div ref={containerRef} style={{ padding: 20 }}>
      <Group justify="center" mb="md">
        <NativeSelect
          label="Layout"
          onChange={d => setLayout(d.currentTarget.value)}
          data={["cartesian", "polar"]}
          defaultValue={layout}
        />

        <NativeSelect
          label="Orientation"
          onChange={d => setOrientation(d.currentTarget.value)}
          defaultValue={orientation}
          data={["vertical", "horizontal"]}
          disabled={layout === "polar"}
        />

        <NativeSelect
          label="Link Type"
          onChange={d => setLinkType(d.currentTarget.value)}
          data={["diagonal", "step", "curve", "line"]}
          defaultValue={linkType}
        />

        <Group>
          <Button onClick={handleZoomIn}>Zoom In</Button>
          <Button onClick={handleZoomOut}>Zoom Out</Button>
          <Button onClick={handleReset}>Reset</Button>
        </Group>
      </Group>
      <svg 
        ref={svgRef}
        width={width} 
        height={height}
        onMouseMove={handlePan}
        style={{ cursor: 'move' }}
      >
        <g transform={`translate(${translate.x},${translate.y}) scale(${zoom})`}>
          <LinearGradient id="lg" from="#fd9b93" to="#fe6e9e" />
          <Tree
            top={margin.top + SVG_PADDING}
            left={margin.left + SVG_PADDING}
            root={hierarchy(processedData, d => (d.isExpanded ? d.children : null))}
            size={[sizeWidth, sizeHeight]}
            separation={(a, b) => (a.parent === b.parent ? 1 : 0.5) / a.depth}
          >
            {tree => (
              <VisxGroup top={origin.y} left={origin.x}>
                {tree.links().map((link, i) => {
                  let LinkComponent;

                  if (layout === "polar") {
                    if (linkType === "step") {
                      LinkComponent = LinkRadialStep;
                    } else if (linkType === "curve") {
                      LinkComponent = LinkRadialCurve;
                    } else if (linkType === "line") {
                      LinkComponent = LinkRadialLine;
                    } else {
                      LinkComponent = LinkRadial;
                    }
                  } else if (orientation === "vertical") {
                    if (linkType === "step") {
                      LinkComponent = LinkVerticalStep;
                    } else if (linkType === "curve") {
                      LinkComponent = LinkVerticalCurve;
                    } else if (linkType === "line") {
                      LinkComponent = LinkVerticalLine;
                    } else {
                      LinkComponent = LinkVertical;
                    }
                  } else if (linkType === "step") {
                    LinkComponent = LinkHorizontalStep;
                  } else if (linkType === "curve") {
                    LinkComponent = LinkHorizontalCurve;
                  } else if (linkType === "line") {
                    LinkComponent = LinkHorizontalLine;
                  } else {
                    LinkComponent = LinkHorizontal;
                  }

                  const key = `${layout}-${linkType}-${i}`;
                  return (
                    <LinkComponent
                      data={link}
                      percent={STEP_PERCENT}
                      stroke="grey"
                      strokeWidth="2"
                      fill="none"
                      key={key}
                    />
                  );
                })}

                {tree.descendants().map(node => {
                  let top;
                  let left;
                  if (layout === "polar") {
                    const [radialX, radialY] = pointRadial(node.x, node.y);
                    top = radialY;
                    left = radialX;
                  } else if (orientation === "vertical") {
                    top = node.y;
                    left = node.x;
                  } else {
                    top = node.x;
                    left = node.y;
                  }

                  const nodeData = node.data as NodeData;
                  const fillColor = nodeData.hex || (nodeData.children ? "#1b6c94" : "#1b8594");

                  return (
                    <VisxGroup top={top} left={left} key={`${node.x}${node.y}`}>
                      <rect
                        height={RECT_HEIGHT}
                        width={RECT_WIDTH}
                        y={-(RECT_HEIGHT / 2)}
                        x={0}
                        fill={fillColor}
                        rx={5}
                        stroke="#dddddd"
                        strokeWidth={2}
                        strokeDasharray="0"
                        strokeOpacity={1}
                        onClick={() => handleNodeClick(node)}
                        style={{ cursor: "pointer" }}
                      />
                      <text y={5} x={10} fontSize={11} style={{ pointerEvents: "none" }} fill="white">
                        {nodeData.name}
                        {nodeData.value ? ` (${nodeData.value})` : ""}
                      </text>
                    </VisxGroup>
                  );
                })}
              </VisxGroup>
            )}
          </Tree>
        </g>
      </svg>
    </div>
  );
}
