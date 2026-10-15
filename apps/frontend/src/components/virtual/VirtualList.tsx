import { useVirtualizer, type Rect, type Virtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import classes from "./VirtualList.module.css";

type VirtualListProps = Readonly<{
  count: number;
  /** A row's height before it is measured; rows measure themselves once rendered. */
  estimateSize: (index: number) => number;
  /** A stable key per row, so a filtered list keeps each row's measured height. */
  getItemKey: (index: number) => string;
  renderItem: (index: number) => ReactNode;
  /** Height of the scroll viewport in px. Rows are virtualized against this, not a measurement. */
  height: number;
  overscan?: number;
  className?: string;
  /** Names the scroll region for assistive technology. */
  "aria-label"?: string;
}>;

/**
 * A vertical list of rows whose heights differ and are only known once rendered (wrapping text),
 * the variable-height sibling of TileGrid: only the rows in and near the viewport are mounted,
 * each measured as it renders. The caller sizes the viewport, as with VirtualGrid, so the rows
 * rendered do not depend on a layout measurement (jsdom has none).
 */
export function VirtualList({
  count,
  estimateSize,
  getItemKey,
  renderItem,
  height,
  overscan = 8,
  className,
  "aria-label": ariaLabel,
}: VirtualListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useRef<Rect>({ width: 0, height });
  viewport.current = { width: 0, height };
  const reportViewport = useRef<((rect: Rect) => void) | null>(null);
  const observeElementRect = useCallback((_instance: unknown, onRect: (rect: Rect) => void) => {
    reportViewport.current = onRect;
    onRect(viewport.current);
    return () => {
      reportViewport.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    reportViewport.current?.({ width: 0, height });
  }, [height]);

  // A row that measures 0 (not laid out: jsdom, a hidden tab) keeps its estimate. Taken as 0 it
  // would pull every following row into the viewport, which would measure 0 in turn.
  const measureElement = useCallback(
    (element: Element, entry: ResizeObserverEntry | undefined, instance: Virtualizer<HTMLDivElement, Element>) => {
      const measured = entry?.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height;
      return measured > 0 ? measured : estimateSize(instance.indexFromElement(element));
    },
    [estimateSize]
  );

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan,
    initialRect: viewport.current,
    observeElementRect,
    measureElement,
  });

  const viewportStyle: CSSProperties = { height };
  const canvasStyle: CSSProperties = { height: virtualizer.getTotalSize() };

  return (
    <div
      ref={scrollRef}
      className={className ? `${classes.viewport} ${className}` : classes.viewport}
      style={viewportStyle}
      // Focusable so the arrow and page keys scroll it.
      tabIndex={0}
      role="region"
      aria-label={ariaLabel}
    >
      <div className={classes.canvas} style={canvasStyle}>
        {virtualizer.getVirtualItems().map(item => {
          const rowStyle: CSSProperties = { transform: `translateY(${item.start}px)` };
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className={classes.row}
              style={rowStyle}
            >
              {renderItem(item.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
