import { ActionIcon, Loader, Text, Tooltip } from "@mantine/core";
import { useHotkeys, useViewportSize } from "@mantine/hooks";
import {
  IconArrowsHorizontal,
  IconArrowsVertical,
  IconFocus,
  IconLine,
  IconMinus,
  IconPlus,
  IconRouteAltLeft,
  IconStairs,
  IconTopologyRing,
  IconTree,
  IconVectorTriangle,
} from "@tabler/icons-react";
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchLocationTreeQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";
import styles from "./LocationLink.module.css";

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
  height?: number;
}>;

type TooltipData = {
  x: number;
  y: number;
  // Shown left of the node: x is then the distance from the right edge of the window
  flip: boolean;
  maxWidth: number;
  name: string;
  value?: number;
  hasChildren: boolean;
};

const STEP_PERCENT = 0.5;
const ZOOM_STEP = 0.15;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const HEADER_HEIGHT = 200;
const RECT_WIDTH = 140;
const RECT_HEIGHT = 32;
const SVG_PADDING = 120;
// The label keeps this much space to the box's edges, and the "+"/"−" glyph takes
// the right INDICATOR_SPACE of a box with children
const LABEL_PADDING = 10;
const INDICATOR_SPACE = 18;
// The root has no siblings to collide with, so its box grows to fit its name
const ROOT_MAX_WIDTH = 220;
// As .nodeText draws it
const LABEL_FONT = "500 12px system-ui, -apple-system, sans-serif";
const LABEL_LETTER_SPACING = 0.2;

let labelContext: CanvasRenderingContext2D | null | undefined;
const labelWidths = new Map<string, number>();

function measureLabel(text: string): number {
  let width = labelWidths.get(text);
  if (width === undefined) {
    if (labelContext === undefined) {
      labelContext = document.createElement("canvas").getContext("2d");
    }
    if (labelContext) {
      labelContext.font = LABEL_FONT;
      width = labelContext.measureText(text).width + text.length * LABEL_LETTER_SPACING;
    } else {
      // No canvas (tests): a rough average glyph width
      width = text.length * 7;
    }
    labelWidths.set(text, width);
  }
  return width;
}

/** Cuts a name to the width it may take, by its measured width rather than its length. */
export function fitLabel(name: string, maxWidth: number, measure: (text: string) => number = measureLabel): string {
  if (measure(name) <= maxWidth) return name;
  let end = name.length - 1;
  while (end > 1 && measure(`${name.slice(0, end).trimEnd()}…`) > maxWidth) end--;
  return `${name.slice(0, end).trimEnd()}…`;
}

// Space between a node and its tooltip, and between the tooltip and the window's edge
const TOOLTIP_GAP = 8;
const TOOLTIP_GUTTER = 8;
// .tooltip's max-width, and the narrowest it gets before it may cover the node
const TOOLTIP_MAX_WIDTH = 250;
const TOOLTIP_MIN_WIDTH = 160;

/**
 * Puts a node's tooltip on the side with room, kept inside the window. Next to a node
 * near the right edge it was squeezed into a one-character-wide column, and flipping
 * it left without checking the room there pushed it out of a phone's window instead.
 */
export function placeTooltip(
  rect: { left: number; right: number },
  viewportWidth: number
): { x: number; flip: boolean; maxWidth: number } {
  const spaceRight = viewportWidth - rect.right - TOOLTIP_GAP - TOOLTIP_GUTTER;
  const spaceLeft = rect.left - TOOLTIP_GAP - TOOLTIP_GUTTER;
  const flip = spaceRight < TOOLTIP_MAX_WIDTH && spaceLeft > spaceRight;
  const maxWidth = Math.min(TOOLTIP_MAX_WIDTH, Math.max(TOOLTIP_MIN_WIDTH, flip ? spaceLeft : spaceRight));
  const x = flip ? viewportWidth - rect.left + TOOLTIP_GAP : rect.right + TOOLTIP_GAP;
  // Where neither side has room for the narrowest tooltip it is moved back into the window
  return {
    x: Math.max(TOOLTIP_GUTTER, Math.min(x, viewportWidth - maxWidth - TOOLTIP_GUTTER)),
    flip,
    maxWidth,
  };
}

// Beautiful gradient colors for nodes
const NODE_COLORS = {
  root: { from: "#6366f1", to: "#8b5cf6" }, // Indigo to violet
  branch: { from: "#0ea5e9", to: "#06b6d4" }, // Sky to cyan
  leaf: { from: "#10b981", to: "#34d399" }, // Emerald shades
};

const LINK_COLORS = {
  dark: "rgba(148, 163, 184, 0.4)", // Slate with transparency
  light: "rgba(100, 116, 139, 0.35)",
};

export function LocationLink({ margin = { top: 0, left: 0, right: 0, bottom: 0 }, height: propHeight }: Props) {
  const { height: viewportHeight } = useViewportSize();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 750, height: 750 });
  const [layout, setLayout] = useState<"cartesian" | "polar">("cartesian");
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [linkType, setLinkType] = useState<"diagonal" | "step" | "curve" | "line">("line");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [showHint, setShowHint] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const { data: locationSunburst, isLoading } = useFetchLocationTreeQuery();
  const { t, i18n } = useTranslation();
  // placetree.photocount is new; until a locale translates it, keep that locale's
  // existing "Photos" word instead of switching the tree to English
  const photoCount = (count: number) =>
    i18n.getResource(i18n.resolvedLanguage ?? "en", "translation", "placetree.photocount_other") === undefined
      ? `${count} ${t("photos.photos")}`
      : t("placetree.photocount", { count });

  // Hide hint after first interaction
  const hideHint = useCallback(() => setShowHint(false), []);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width } = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: Math.max(width, 400),
          height: propHeight ?? viewportHeight - HEADER_HEIGHT,
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, [viewportHeight, propHeight]);

  const { width, height } = dimensions;
  const innerWidth = width - margin.left - margin.right - 2 * SVG_PADDING;
  const innerHeight = height - margin.top - margin.bottom - 2 * SVG_PADDING;

  const { origin, sizeWidth, sizeHeight } = useMemo(() => {
    if (layout === "polar") {
      return {
        origin: { x: innerWidth / 2, y: innerHeight / 2 },
        sizeWidth: 2 * Math.PI,
        sizeHeight: Math.min(innerWidth, innerHeight) / 2,
      };
    }
    if (orientation === "vertical") {
      return {
        origin: { x: SVG_PADDING, y: SVG_PADDING },
        sizeWidth: innerWidth,
        sizeHeight: innerHeight,
      };
    }
    return {
      origin: { x: SVG_PADDING, y: SVG_PADDING },
      sizeWidth: innerHeight,
      sizeHeight: innerWidth,
    };
  }, [layout, orientation, innerWidth, innerHeight]);

  const handleNodeClick = useCallback(
    (node: { data: NodeData }) => {
      hideHint();
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
    },
    [hideHint]
  );

  const handleZoomIn = useCallback(() => {
    hideHint();
    setZoom(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, [hideHint]);

  const handleZoomOut = useCallback(() => {
    hideHint();
    setZoom(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }, [hideHint]);

  const handleReset = useCallback(() => {
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handlePan = useCallback(
    (e: React.MouseEvent) => {
      if (e.buttons === 1) {
        hideHint();
        setTranslate(prev => ({
          x: prev.x + e.movementX,
          y: prev.y + e.movementY,
        }));
      }
    },
    [hideHint]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      hideHint();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom(prev => Math.min(Math.max(prev + delta, MIN_ZOOM), MAX_ZOOM));
    },
    [hideHint]
  );

  // Keyboard shortcuts
  useHotkeys([
    ["=", handleZoomIn],
    ["+", handleZoomIn],
    ["-", handleZoomOut],
    ["0", handleReset],
  ]);

  const handleNodeMouseEnter = useCallback((e: React.MouseEvent, nodeData: NodeData) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      ...placeTooltip(rect, document.documentElement.clientWidth),
      y: rect.top + rect.height / 2,
      name: nodeData.name,
      value: nodeData.value,
      hasChildren: !!nodeData.children?.length,
    });
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const processData = useCallback(
    (data: NodeData): NodeData => {
      const processed = { ...data };
      if (processed.children) {
        processed.isExpanded = expandedNodes.has(processed.name);
        processed.children = processed.children.map(child => processData(child));
      }
      return processed;
    },
    [expandedNodes]
  );

  const getNodeColor = useCallback((node: { depth: number; data: NodeData }) => {
    if (node.data.hex) return { from: node.data.hex, to: node.data.hex };
    if (node.depth === 0) return NODE_COLORS.root;
    if (node.data.children?.length) return NODE_COLORS.branch;
    return NODE_COLORS.leaf;
  }, []);

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className={styles.container}
        style={{ height: propHeight ?? viewportHeight - HEADER_HEIGHT }}
      >
        <div className={styles.loadingOverlay}>
          <Loader size="lg" color="blue" />
          <Text c="dimmed" size="sm">
            {t("placetree.loading", "Loading place tree...")}
          </Text>
        </div>
      </div>
    );
  }

  if (!locationSunburst || !locationSunburst.children?.length) {
    return (
      <div
        ref={containerRef}
        className={styles.container}
        style={{ height: propHeight ?? viewportHeight - HEADER_HEIGHT }}
      >
        <div className={styles.emptyContainer}>
          <EmptyState
            icon={<IconVectorTriangle size={40} />}
            title={t("emptystate.placetree.title", "No location data yet")}
            description={t(
              "emptystate.placetree.description",
              "Upload photos with location information to see your places visualized as a tree."
            )}
            actionLabel={t("emptystate.goToLibrary")}
            actionLink="/library"
          />
        </div>
      </div>
    );
  }

  const processedData = processData(locationSunburst);

  return (
    <div ref={containerRef} className={styles.container} style={{ height }}>
      {/* Control Toolbar */}
      <div className={styles.controlsToolbar}>
        {/* Layout Section */}
        <div className={styles.toolbarGroup}>
          <Tooltip label={t("placetree.cartesian", "Tree Layout")} position="bottom" withArrow>
            <ActionIcon
              variant={layout === "cartesian" ? "filled" : "subtle"}
              color={layout === "cartesian" ? "blue" : "gray"}
              size="md"
              onClick={() => setLayout("cartesian")}
              className={styles.toolbarButton}
            >
              <IconTree size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("placetree.polar", "Radial Layout")} position="bottom" withArrow>
            <ActionIcon
              variant={layout === "polar" ? "filled" : "subtle"}
              color={layout === "polar" ? "blue" : "gray"}
              size="md"
              onClick={() => setLayout("polar")}
              className={styles.toolbarButton}
            >
              <IconTopologyRing size={18} />
            </ActionIcon>
          </Tooltip>
        </div>

        {layout === "cartesian" && (
          <>
            <div className={styles.toolbarDivider} />
            <div className={styles.toolbarGroup}>
              <Tooltip label={t("placetree.horizontal", "Horizontal")} position="bottom" withArrow>
                <ActionIcon
                  variant={orientation === "horizontal" ? "filled" : "subtle"}
                  color={orientation === "horizontal" ? "cyan" : "gray"}
                  size="md"
                  onClick={() => setOrientation("horizontal")}
                  className={styles.toolbarButton}
                >
                  <IconArrowsHorizontal size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("placetree.vertical", "Vertical")} position="bottom" withArrow>
                <ActionIcon
                  variant={orientation === "vertical" ? "filled" : "subtle"}
                  color={orientation === "vertical" ? "cyan" : "gray"}
                  size="md"
                  onClick={() => setOrientation("vertical")}
                  className={styles.toolbarButton}
                >
                  <IconArrowsVertical size={18} />
                </ActionIcon>
              </Tooltip>
            </div>
          </>
        )}

        <div className={styles.toolbarDivider} />

        {/* Link Style Section */}
        <div className={styles.toolbarGroup}>
          <Tooltip label={t("placetree.curve", "Curved Lines")} position="bottom" withArrow>
            <ActionIcon
              variant={linkType === "curve" ? "filled" : "subtle"}
              color={linkType === "curve" ? "violet" : "gray"}
              size="md"
              onClick={() => setLinkType("curve")}
              className={styles.toolbarButton}
            >
              <IconRouteAltLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("placetree.step", "Step Lines")} position="bottom" withArrow>
            <ActionIcon
              variant={linkType === "step" ? "filled" : "subtle"}
              color={linkType === "step" ? "violet" : "gray"}
              size="md"
              onClick={() => setLinkType("step")}
              className={styles.toolbarButton}
            >
              <IconStairs size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("placetree.line", "Straight Lines")} position="bottom" withArrow>
            <ActionIcon
              variant={linkType === "line" ? "filled" : "subtle"}
              color={linkType === "line" ? "violet" : "gray"}
              size="md"
              onClick={() => setLinkType("line")}
              className={styles.toolbarButton}
            >
              <IconLine size={18} />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>

      {/* Zoom Controls */}
      <div className={styles.zoomControls}>
        <Tooltip label={t("placetree.zoomIn", "Zoom in (+)")} position="left">
          <button className={styles.zoomButton} onClick={handleZoomIn} type="button" aria-label="Zoom in">
            <IconPlus size={18} />
          </button>
        </Tooltip>
        <div className={styles.zoomLevel}>{Math.round(zoom * 100)}%</div>
        <Tooltip label={t("placetree.zoomOut", "Zoom out (-)")} position="left">
          <button className={styles.zoomButton} onClick={handleZoomOut} type="button" aria-label="Zoom out">
            <IconMinus size={18} />
          </button>
        </Tooltip>
        <div className={styles.zoomDivider} />
        <Tooltip label={t("placetree.reset", "Reset view (0)")} position="left">
          <button className={styles.zoomButton} onClick={handleReset} type="button" aria-label="Reset view">
            <IconFocus size={18} />
          </button>
        </Tooltip>
      </div>

      {/* Hint */}
      {showHint && (
        <div className={styles.hint}>{t("placetree.hint", "Click nodes to expand • Drag to pan • Scroll to zoom")}</div>
      )}

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className={styles.svgCanvas}
        onMouseMove={handlePan}
        onWheel={handleWheel}
        tabIndex={0}
        aria-label={t("placetree.ariaLabel", "Interactive place tree visualization")}
      >
        <defs>
          <LinearGradient
            id="node-gradient-root"
            from={NODE_COLORS.root.from}
            to={NODE_COLORS.root.to}
            vertical={false}
          />
          <LinearGradient
            id="node-gradient-branch"
            from={NODE_COLORS.branch.from}
            to={NODE_COLORS.branch.to}
            vertical={false}
          />
          <LinearGradient
            id="node-gradient-leaf"
            from={NODE_COLORS.leaf.from}
            to={NODE_COLORS.leaf.to}
            vertical={false}
          />
          <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.25" />
          </filter>
        </defs>

        <g transform={`translate(${translate.x},${translate.y}) scale(${zoom})`}>
          <Tree
            top={margin.top + SVG_PADDING}
            left={margin.left + SVG_PADDING}
            root={hierarchy(processedData, d => (d.isExpanded ? d.children : null))}
            size={[sizeWidth, sizeHeight]}
            separation={(a, b) => (a.parent === b.parent ? 1 : 0.5) / a.depth}
          >
            {tree => (
              <VisxGroup top={origin.y} left={origin.x}>
                {/* Links */}
                {tree.links().map((link, i) => {
                  const key = `link-${layout}-${linkType}-${i}`;
                  let LinkComponent;

                  if (layout === "polar") {
                    if (linkType === "step") LinkComponent = LinkRadialStep;
                    else if (linkType === "curve") LinkComponent = LinkRadialCurve;
                    else if (linkType === "line") LinkComponent = LinkRadialLine;
                    else LinkComponent = LinkRadial;
                  } else if (orientation === "vertical") {
                    if (linkType === "step") LinkComponent = LinkVerticalStep;
                    else if (linkType === "curve") LinkComponent = LinkVerticalCurve;
                    else if (linkType === "line") LinkComponent = LinkVerticalLine;
                    else LinkComponent = LinkVertical;
                  } else if (linkType === "step") {
                    LinkComponent = LinkHorizontalStep;
                  } else if (linkType === "curve") {
                    LinkComponent = LinkHorizontalCurve;
                  } else if (linkType === "line") {
                    LinkComponent = LinkHorizontalLine;
                  } else {
                    LinkComponent = LinkHorizontal;
                  }

                  return (
                    <LinkComponent
                      key={key}
                      data={link}
                      percent={STEP_PERCENT}
                      stroke={LINK_COLORS.dark}
                      strokeWidth={2}
                      strokeLinecap="round"
                      fill="none"
                      className={styles.link}
                    />
                  );
                })}

                {/* Nodes */}
                {tree.descendants().map((node, idx) => {
                  const key = `node-${node.x}-${node.y}-${idx}`;
                  let top: number;
                  let left: number;

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
                  const colors = getNodeColor(node);
                  const hasChildren = !!nodeData.children?.length;
                  const isExpanded = expandedNodes.has(nodeData.name);

                  // Cut long names to the box, left of the expand glyph; the tooltip has the full name
                  const indicatorSpace = hasChildren ? INDICATOR_SPACE : 0;
                  const rectWidth =
                    node.depth === 0
                      ? Math.min(
                          ROOT_MAX_WIDTH,
                          Math.max(RECT_WIDTH, measureLabel(nodeData.name) + 2 * LABEL_PADDING + indicatorSpace)
                        )
                      : RECT_WIDTH;
                  const displayName = fitLabel(nodeData.name, rectWidth - 2 * LABEL_PADDING - indicatorSpace);
                  const labelX = -indicatorSpace / 2;

                  return (
                    <VisxGroup
                      key={key}
                      top={top}
                      left={left}
                      className={styles.nodeGroup}
                      onClick={() => handleNodeClick(node)}
                      onMouseEnter={e => handleNodeMouseEnter(e, nodeData)}
                      onMouseLeave={handleNodeMouseLeave}
                    >
                      <defs>
                        <linearGradient id={`node-grad-${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor={colors.from} />
                          <stop offset="100%" stopColor={colors.to} />
                        </linearGradient>
                      </defs>
                      <rect
                        height={RECT_HEIGHT}
                        width={rectWidth}
                        y={-RECT_HEIGHT / 2}
                        x={-rectWidth / 2}
                        fill={`url(#node-grad-${idx})`}
                        rx={8}
                        className={styles.nodeRect}
                        style={{ filter: "url(#node-shadow)" }}
                      />
                      <text
                        y={nodeData.value ? -2 : 1}
                        x={labelX}
                        fontSize={12}
                        fontFamily="system-ui, -apple-system, sans-serif"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="white"
                        className={styles.nodeText}
                      >
                        {displayName}
                      </text>
                      {nodeData.value && (
                        <text
                          y={10}
                          x={labelX}
                          fontSize={10}
                          fontFamily="system-ui, -apple-system, sans-serif"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="rgba(255,255,255,0.75)"
                          className={styles.nodeText}
                        >
                          {photoCount(nodeData.value)}
                        </text>
                      )}
                      {hasChildren && (
                        <text
                          y={0}
                          x={rectWidth / 2 - 12}
                          fontSize={14}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="rgba(255,255,255,0.8)"
                          className={styles.expandIndicator}
                        >
                          {isExpanded ? "−" : "+"}
                        </text>
                      )}
                    </VisxGroup>
                  );
                })}
              </VisxGroup>
            )}
          </Tree>
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className={styles.tooltip}
          style={{
            ...(tooltip.flip ? { right: tooltip.x } : { left: tooltip.x }),
            maxWidth: tooltip.maxWidth,
            top: tooltip.y,
            transform: "translateY(-50%)",
          }}
        >
          <div className={styles.tooltipTitle}>{tooltip.name}</div>
          {tooltip.value && <div className={styles.tooltipCount}>{photoCount(tooltip.value)}</div>}
          {tooltip.hasChildren && (
            <div className={styles.tooltipHint}>{t("placetree.clickToExpand", "Click to expand/collapse")}</div>
          )}
        </div>
      )}
    </div>
  );
}
