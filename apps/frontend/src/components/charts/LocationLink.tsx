import { ActionIcon, Loader, Text, Tooltip } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
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
  IconVectorTriangle 
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
import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useViewportSize } from "@mantine/hooks";
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

// Beautiful gradient colors for nodes
const NODE_COLORS = {
  root: { from: "#6366f1", to: "#8b5cf6" },      // Indigo to violet
  branch: { from: "#0ea5e9", to: "#06b6d4" },   // Sky to cyan  
  leaf: { from: "#10b981", to: "#34d399" },     // Emerald shades
};

const LINK_COLORS = {
  dark: "rgba(148, 163, 184, 0.4)",  // Slate with transparency
  light: "rgba(100, 116, 139, 0.35)",
};

export function LocationLink({
  margin = { top: 0, left: 0, right: 0, bottom: 0 },
  height: propHeight,
}: Props) {
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
  const { t } = useTranslation();

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

  const handleNodeClick = useCallback((node: { data: NodeData }) => {
    hideHint();
    const nodePath = node.data.name;
    setExpandedNodes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodePath)) {
        newSet.delete(nodePath);
      } else {
        newSet.add(nodePath);
      }
      return newSet;
    });
  }, [hideHint]);

  const handleZoomIn = useCallback(() => {
    hideHint();
    setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, [hideHint]);

  const handleZoomOut = useCallback(() => {
    hideHint();
    setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }, [hideHint]);

  const handleReset = useCallback(() => {
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handlePan = useCallback(
    (e: React.MouseEvent) => {
      if (e.buttons === 1) {
        hideHint();
        setTranslate((prev) => ({
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
      setZoom((prev) => Math.min(Math.max(prev + delta, MIN_ZOOM), MAX_ZOOM));
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

  const handleNodeMouseEnter = useCallback(
    (e: React.MouseEvent, nodeData: NodeData) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({
        x: rect.right + 8,
        y: rect.top + rect.height / 2,
        name: nodeData.name,
        value: nodeData.value,
        hasChildren: !!nodeData.children?.length,
      });
    },
    []
  );

  const handleNodeMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const processData = useCallback(
    (data: NodeData): NodeData => {
      const processed = { ...data };
      if (processed.children) {
        processed.isExpanded = expandedNodes.has(processed.name);
        processed.children = processed.children.map((child) => processData(child));
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
      <div ref={containerRef} className={styles.container} style={{ height: propHeight ?? viewportHeight - HEADER_HEIGHT }}>
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
      <div ref={containerRef} className={styles.container} style={{ height: propHeight ?? viewportHeight - HEADER_HEIGHT }}>
        <div className={styles.emptyContainer}>
          <EmptyState
            icon={<IconVectorTriangle size={40} />}
            title={t("emptystate.placetree.title", "No location data yet")}
            description={t("emptystate.placetree.description", "Upload photos with location information to see your places visualized as a tree.")}
            actionLabel={t("emptystate.goToLibrary")}
            actionLink="/library"
          />
        </div>
      </div>
    );
  }

  const processedData = processData(locationSunburst);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ height }}
    >
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
        <div className={styles.hint}>
          {t("placetree.hint", "Click nodes to expand • Drag to pan • Scroll to zoom")}
        </div>
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
          <LinearGradient id="node-gradient-root" from={NODE_COLORS.root.from} to={NODE_COLORS.root.to} vertical={false} />
          <LinearGradient id="node-gradient-branch" from={NODE_COLORS.branch.from} to={NODE_COLORS.branch.to} vertical={false} />
          <LinearGradient id="node-gradient-leaf" from={NODE_COLORS.leaf.from} to={NODE_COLORS.leaf.to} vertical={false} />
          <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.25" />
          </filter>
        </defs>

        <g transform={`translate(${translate.x},${translate.y}) scale(${zoom})`}>
          <Tree
            top={margin.top + SVG_PADDING}
            left={margin.left + SVG_PADDING}
            root={hierarchy(processedData, (d) => (d.isExpanded ? d.children : null))}
            size={[sizeWidth, sizeHeight]}
            separation={(a, b) => (a.parent === b.parent ? 1 : 0.5) / a.depth}
          >
            {(tree) => (
              <VisxGroup top={origin.y} left={origin.x}>
                {/* Links */}
                {tree.links().map((link, i) => {
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
                      key={`link-${layout}-${linkType}-${i}`}
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

                  // Truncate long names
                  const displayName = nodeData.name.length > 16 
                    ? `${nodeData.name.substring(0, 14)}…` 
                    : nodeData.name;

                  return (
                    <VisxGroup
                      key={`node-${node.x}-${node.y}-${idx}`}
                      top={top}
                      left={left}
                      className={styles.nodeGroup}
                      onClick={() => handleNodeClick(node)}
                      onMouseEnter={(e) => handleNodeMouseEnter(e, nodeData)}
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
                        width={RECT_WIDTH}
                        y={-RECT_HEIGHT / 2}
                        x={-RECT_WIDTH / 2}
                        fill={`url(#node-grad-${idx})`}
                        rx={8}
                        className={styles.nodeRect}
                        style={{ filter: "url(#node-shadow)" }}
                      />
                      <text
                        y={nodeData.value ? -2 : 1}
                        x={0}
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
                          x={0}
                          fontSize={10}
                          fontFamily="system-ui, -apple-system, sans-serif"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="rgba(255,255,255,0.75)"
                          className={styles.nodeText}
                        >
                          {nodeData.value} {nodeData.value === 1 ? t("photo") : t("photos.photos")}
                        </text>
                      )}
                      {hasChildren && (
                        <text
                          y={0}
                          x={RECT_WIDTH / 2 - 12}
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
            left: tooltip.x,
            top: tooltip.y,
            transform: "translateY(-50%)",
          }}
        >
          <div className={styles.tooltipTitle}>{tooltip.name}</div>
          {tooltip.value && (
            <div className={styles.tooltipCount}>
              {tooltip.value} {tooltip.value === 1 ? t("photo") : t("photos.photos")}
            </div>
          )}
          {tooltip.hasChildren && (
            <div className={styles.tooltipHint}>
              {t("placetree.clickToExpand", "Click to expand/collapse")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
