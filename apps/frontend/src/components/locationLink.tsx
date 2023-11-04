import { Group as GroupMantine, NativeSelect } from "@mantine/core";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
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
import React, { useEffect, useState } from "react";

import { fetchLocationSunburst } from "../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../store/store";

type Props = {
  width: number;
  height: number;
  margin?: { top: number; left: number; right: number; bottom: number };
};

export function LocationLink(props: Props) {
  const [layout, setLayout] = useState("cartesian");
  const [orientation, setOrientation] = useState("horizontal");
  const [linkType, setLinkType] = useState("diagonal");
  const [stepPercent] = useState(0.5);

  const { locationSunburst } = useAppSelector(store => store.util);
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchLocationSunburst());
  }, []);

  const {
    width,
    height,
    margin = {
      top: 20,
      left: 100,
      right: 100,
      bottom: 20,
    },
  } = props;

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  let origin;
  let sizeWidth;
  let sizeHeight;

  if (layout === "polar") {
    origin = {
      x: innerWidth / 2,
      y: innerHeight / 2,
    };
    sizeWidth = 2 * Math.PI;
    sizeHeight = Math.min(innerWidth, innerHeight) / 2;
  } else {
    origin = { x: 0, y: 0 };
    if (orientation === "vertical") {
      sizeWidth = innerWidth;
      sizeHeight = innerHeight;
    } else {
      sizeWidth = innerHeight;
      sizeHeight = innerWidth;
    }
  }

  return (
    <div style={{ padding: 10 }}>
      <GroupMantine position="center">
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
      </GroupMantine>
      <svg width={width} height={height}>
        <LinearGradient id="lg" from="#fd9b93" to="#fe6e9e" />
        <Tree
          top={margin.top}
          left={margin.left}
          root={hierarchy(locationSunburst, d => (d.isExpanded ? d.children : null))}
          size={[sizeWidth, sizeHeight]}
          separation={(a, b) => (a.parent === b.parent ? 1 : 0.5) / a.depth}
        >
          {tree => (
            <Group top={origin.y} left={origin.x}>
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
                    percent={stepPercent}
                    stroke="grey"
                    strokeWidth="2"
                    fill="none"
                    key={key}
                  />
                );
              })}

              {tree.descendants().map(node => {
                const rectWidth = 120;
                const rectHeight = 30;

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

                return (
                  <Group top={top} left={left} key={`${node.x}${node.y}`}>
                    {node.depth === 0 && (
                      <rect
                        height={rectHeight}
                        width={rectWidth}
                        y={-(rectHeight / 2)}
                        x={0}
                        fill="#1b5a94"
                        rx={5}
                        stroke="#dddddd"
                        onClick={() => {
                          node.data.isExpanded = !node.data.isExpanded;
                        }}
                      />
                    )}
                    {node.depth !== 0 && (
                      <rect
                        height={rectHeight}
                        width={rectWidth}
                        y={-(rectHeight / 2)}
                        x={0}
                        fill={node.data.children ? "#1b6c94" : "#1b8594"}
                        stroke={node.data.children ? "#dddddd" : "#dddddd"}
                        strokeWidth={2}
                        strokeDasharray={!node.data.children ? "0" : "0"}
                        strokeOpacity={!node.data.children ? 1 : 1}
                        rx={!node.data.children ? 5 : 5}
                        onClick={() => {
                          node.data.isExpanded = !node.data.isExpanded;
                        }}
                      />
                    )}
                    <text y={5} x={10} fontSize={11} style={{ pointerEvents: "none" }} fill="white">
                      {node.data.name}
                    </text>
                  </Group>
                );
              })}
            </Group>
          )}
        </Tree>
      </svg>
    </div>
  );
}
