import React from "react";
import { Group } from "@vx/group";
import { Tree } from "@vx/hierarchy";
import { LinearGradient } from "@vx/gradient";
import { hierarchy } from "d3-hierarchy";
import { pointRadial } from "d3-shape";
import { fetchLocationSunburst } from "../actions/utilActions";
import { connect } from "react-redux";
import { Form } from "semantic-ui-react";

import {
  LinkHorizontal,
  LinkVertical,
  LinkRadial,
  LinkHorizontalStep,
  LinkVerticalStep,
  LinkRadialStep,
  LinkHorizontalCurve,
  LinkVerticalCurve,
  LinkRadialCurve,
  LinkHorizontalLine,
  LinkVerticalLine,
  LinkRadialLine
} from "@vx/shape";


export class LocationLink extends React.Component {
  state = {
    layout: "cartesian",
    orientation: "horizontal",
    linkType: "diagonal",
    stepPercent: 0.5
  };

  componentWillMount() {
    if (!this.props.locationSunburst.children) {
      this.props.dispatch(fetchLocationSunburst());
    }
  }

  render() {
    const {
      width,
      height,
      margin = {
        top: 20,
        left: 70,
        right: 70,
        bottom: 20
      }
    } = this.props;
    const { layout, orientation, linkType, stepPercent } = this.state;

    if (width < 10) return null;
    if (this.props.fetchedLocationSunburst) return null;

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    let origin;
    let sizeWidth;
    let sizeHeight;

    if (layout === "polar") {
      origin = {
        x: innerWidth / 2,
        y: innerHeight / 2
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
      <div style={{padding:10}}>
        <div>
          <Form unstackable widths="equal">
            <Form.Group>
              <Form.Dropdown
                label="Layout"
                fluid
                labeled
                selection
                onChange={(e, d) => this.setState({ layout: d.value })}
                options={[
                  { text: "cartesian", value: "cartesian" },
                  { text: "polar", value: "polar" }
                ]}
                defaultValue={layout}
              />

              <Form.Dropdown
                label="Orientation"
                fluid
                selection
                onChange={(e, d) => this.setState({ orientation: d.value })}
                defaultValue={orientation}
                options={[
                  { text: "vertical", value: "vertical" },
                  { text: "horizontal", value: "horizontal" }
                ]}
                disabled={layout === "polar"}
              />

              <Form.Dropdown
                label="Link Type"
                fluid
                selection
                onChange={(e, d) => this.setState({ linkType: d.value })}
                options={[
                  { text: "diagonal", value: "diagonal" },
                  { text: "step", value: "step" },
                  { text: "curve", value: "curve" },
                  { text: "line", value: "line" }
                ]}
                defaultValue={linkType}
              />
            </Form.Group>
          </Form>
        </div>

        <svg width={width} height={height}>
          <LinearGradient id="lg" from="#fd9b93" to="#fe6e9e" />
          <rect width={width} height={height} rx={3} fill="#ffffff" />
          <Tree
            top={margin.top}
            left={margin.left}
            root={hierarchy(
              this.props.locationSunburst,
              d => (d.isExpanded ? d.children : null)
            )}
            size={[sizeWidth, sizeHeight]}
            separation={(a, b) => (a.parent === b.parent ? 1 : 0.5) / a.depth}
          >
            {({ data }) => (
              <Group top={origin.y} left={origin.x}>
                {data.links().map((link, i) => {
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
                  } else {
                    if (orientation === "vertical") {
                      if (linkType === "step") {
                        LinkComponent = LinkVerticalStep;
                      } else if (linkType === "curve") {
                        LinkComponent = LinkVerticalCurve;
                      } else if (linkType === "line") {
                        LinkComponent = LinkVerticalLine;
                      } else {
                        LinkComponent = LinkVertical;
                      }
                    } else {
                      if (linkType === "step") {
                        LinkComponent = LinkHorizontalStep;
                      } else if (linkType === "curve") {
                        LinkComponent = LinkHorizontalCurve;
                      } else if (linkType === "line") {
                        LinkComponent = LinkHorizontalLine;
                      } else {
                        LinkComponent = LinkHorizontal;
                      }
                    }
                  }

                  return (
                    <LinkComponent
                      data={link}
                      percent={stepPercent}
                      stroke="grey"
                      strokeWidth="2"
                      fill="none"
                      key={i}
                    />
                  );
                })}

                {data.descendants().map((node, key) => {
                  const width = 120;
                  const height = 30;

                  let top;
                  let left;
                  if (layout === "polar") {
                    const [radialX, radialY] = pointRadial(node.x, node.y);
                    top = radialY;
                    left = radialX;
                  } else {
                    if (orientation === "vertical") {
                      top = node.y;
                      left = node.x;
                    } else {
                      top = node.x;
                      left = node.y;
                    }
                  }

                  return (
                    <Group top={top} left={left} key={key}>
                      {node.depth === 0 && (
                        <rect
                          height={height}
                          width={width}
                          y={-height / 2}
                          x={-width / 2}
                          fill="#1b5a94"
                          rx={5}
                          stroke="#dddddd"
                          onClick={() => {
                            node.data.isExpanded = !node.data.isExpanded;
                            this.forceUpdate();
                          }}
                        />
                      )}
                      {node.depth !== 0 && (
                        <rect
                          height={height}
                          width={width}
                          y={-height / 2}
                          x={-width / 2}
                          fill={node.data.children ? "#1b6c94" : "#1b8594"}
                          stroke={node.data.children ? "#dddddd" : "#dddddd"}
                          strokeWidth={2}
                          strokeDasharray={!node.data.children ? "0" : "0"}
                          strokeOpacity={!node.data.children ? 1 : 1}
                          rx={!node.data.children ? 5 : 5}
                          onClick={() => {
                            node.data.isExpanded = !node.data.isExpanded;
                            this.forceUpdate();
                          }}
                        />
                      )}
                      <text
                        dy={".33em"}
                        fontSize={11}
                        fontFamily="Arial"
                        textAnchor={"middle"}
                        style={{ pointerEvents: "none" }}
                        fill={
                          node.depth === 0
                            ? "white"
                            : node.children
                              ? "white"
                              : "white"
                        }
                      >
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
}

LocationLink = connect(store => {
  return {
    locationSunburst: store.util.locationSunburst,
    fetchingLocationSunburst: store.util.fetchingLocationSunburst,
    fetchedLocationSunburst: store.util.fetechedLocationSunburst
  };
})(LocationLink);
