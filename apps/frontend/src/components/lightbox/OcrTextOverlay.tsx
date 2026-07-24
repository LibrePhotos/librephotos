import React, { useEffect, useMemo, useRef } from "react";
import type { PhotoOcrBlock } from "../../api_client/photos/types";

// The viewBox is a fixed 1000 user units wide; its height follows the image
// aspect ratio so x and y use the same scale and glyphs are not distorted.
const VIEW_WIDTH = 1000;

export type OcrTextOverlayProps = {
  blocks: PhotoOcrBlock[];
  // naturalHeight / naturalWidth of the displayed image
  aspectRatio: number;
};

type PlacedBlock = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // Rotation of the block's top edge, in degrees
  angle: number;
};

// Turn a normalized quad into a translated/rotated rectangle in viewBox units.
// The quad corners arrive clockwise from top-left, so the top edge gives the
// baseline direction and the left edge the line height.
export function placeBlock(block: PhotoOcrBlock, viewHeight: number): PlacedBlock | null {
  if (!block.text || !Array.isArray(block.box) || block.box.length !== 4) return null;
  const corners = block.box.map(([nx, ny]) => ({ x: nx * VIEW_WIDTH, y: ny * viewHeight }));
  const [topLeft, topRight, , bottomLeft] = corners;
  const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
  const height = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
  if (width <= 0 || height <= 0) return null;
  const angle = (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) / Math.PI;
  return { text: block.text, x: topLeft.x, y: topLeft.y, width, height, angle };
}

/**
 * Selectable "live text" layer over a photo, Apple Photos style.
 *
 * Renders each OCR block as an invisible SVG <text> stretched to its detected
 * box, so the browser's native selection, copy, and context menu all work on
 * text that visually sits on the image. The SVG root ignores pointer events —
 * only the glyphs are interactive — so clicks on textless areas still reach
 * the image below (zoom, pan, swipe).
 */
export function OcrTextOverlay({ blocks, aspectRatio }: OcrTextOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewHeight = VIEW_WIDTH * aspectRatio;

  const placed = useMemo(
    () => blocks.map(block => placeBlock(block, viewHeight)).filter((b): b is PlacedBlock => b !== null),
    [blocks, viewHeight]
  );

  // Selection drags must not start a carousel swipe or a pan. Embla and
  // use-gesture see events before React's synthetic handlers would, so the
  // propagation stop has to be a native listener. It only fires for events
  // originating on the glyphs — everything else passes through the svg.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const stop = (event: Event) => event.stopPropagation();
    const events = ["pointerdown", "mousedown", "touchstart"];
    events.forEach(name => svg.addEventListener(name, stop));
    return () => events.forEach(name => svg.removeEventListener(name, stop));
  }, []);

  if (!placed.length || !(viewHeight > 0)) return null;

  return (
    <svg
      ref={svgRef}
      data-testid="ocr-text-overlay"
      viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        pointerEvents: "none",
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    >
      {placed.map((block, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <g key={index} transform={`translate(${block.x} ${block.y}) rotate(${block.angle})`}>
          {/* Faint backdrop marking the block as selectable, like Live Text's glow */}
          <rect
            width={block.width}
            height={block.height}
            rx={Math.min(block.height * 0.2, 8)}
            fill="rgba(255, 255, 255, 0.16)"
            stroke="rgba(255, 255, 255, 0.35)"
            strokeWidth={0.5}
            pointerEvents="none"
          />
          <text
            x={block.width / 2}
            y={block.height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={block.height * 0.8}
            textLength={block.width * 0.95}
            lengthAdjust="spacingAndGlyphs"
            fill="transparent"
            style={{ pointerEvents: "auto", cursor: "text", whiteSpace: "pre" }}
          >
            {block.text}
          </text>
        </g>
      ))}
    </svg>
  );
}
