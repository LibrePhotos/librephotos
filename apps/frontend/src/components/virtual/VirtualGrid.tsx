import { defaultRangeExtractor, useVirtualizer, type Range, type Rect } from "@tanstack/react-virtual";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { CSSProperties, ReactNode, UIEvent } from "react";
import { sectionBounds, useGridFocus, withPinnedRow } from "./useGridFocus";
import classes from "./VirtualGrid.module.css";

export type GridCellProps = Readonly<{
  columnIndex: number;
  rowIndex: number;
  key: string;
  style: CSSProperties;
}>;

export type SectionRenderedParams = Readonly<{
  rowOverscanStartIndex: number;
  rowOverscanStopIndex: number;
  columnOverscanStartIndex: number;
  columnOverscanStopIndex: number;
}>;

export type GridScrollParams = Readonly<{
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}>;

export type VirtualGridHandle = Readonly<{
  scrollToPosition: (position: { scrollTop: number }) => void;
}>;

type VirtualGridProps = Readonly<{
  cellRenderer: (props: GridCellProps) => ReactNode;
  columnCount: number;
  columnWidth: number;
  rowCount: number;
  rowHeight: number | ((params: { index: number }) => number);
  /** Height of the scroll viewport in px. Rows are virtualized against this, not a measurement. */
  height: number;
  /** Width in px; defaults to the width of the parent. */
  width?: number;
  /** Rows rendered above and below the viewport. */
  overscanRowCount?: number;
  /** Scrolls here when mounted and whenever it changes; leave undefined to let the user scroll. */
  scrollTop?: number;
  onScroll?: (params: GridScrollParams) => void;
  /** Called with the rendered row range whenever it changes. Every column of a rendered row is rendered. */
  onSectionRendered?: (params: SectionRenderedParams) => void;
  className?: string;
  style?: CSSProperties;
  /**
   * Keep the row holding keyboard focus rendered while it scrolls out of view, so focus (and an
   * open menu anchored there) is not dropped onto the page when the row would unmount; and when
   * the focused control goes away with its cell's content, focus the same control (by its
   * `data-focus-key`) once the cell shows new content. See useGridFocus.
   */
  keepFocusedRowMounted?: boolean;
}>;

/**
 * The rows' key function for one row-size function. The key is the index, but the virtualizer
 * caches row offsets until one of its measurement options changes, and estimateSize is not one
 * of them while the key function is: a new key function per row-size function makes a row
 * height change re-lay-out every row in the same render. (`virtualizer.measure()` would do it
 * one render later, after the old range had already been reported.)
 */
function indexKeyFor(_estimateSize: (index: number) => number): (index: number) => number {
  return (index: number) => index;
}

/**
 * A row-virtualized grid of absolutely positioned cells, the shape the album and face pages
 * were built around with react-virtualized's Grid: the caller sizes the viewport and renders
 * one cell per (row, column) with the style it is handed. Rows are virtualized, columns are
 * not - every page shows at most a dozen columns.
 */
export const VirtualGrid = forwardRef<VirtualGridHandle, VirtualGridProps>(function VirtualGrid(
  {
    cellRenderer,
    columnCount,
    columnWidth,
    rowCount,
    rowHeight,
    height,
    width,
    overscanRowCount = 10,
    scrollTop,
    onScroll,
    onSectionRendered,
    className,
    style,
    keepFocusedRowMounted = false,
  },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { pinnedRow, handleFocus } = useGridFocus(keepFocusedRowMounted, scrollRef);
  const rangeExtractor = useCallback(
    (range: Range) => withPinnedRow(defaultRangeExtractor(range), pinnedRow, range.count),
    [pinnedRow]
  );

  // The viewport size comes from props, as react-virtualized's did, so the rendered rows do not
  // depend on a layout measurement (jsdom has none) and follow a resize in the same render.
  const viewport = useRef<Rect>({ width: width ?? 0, height });
  viewport.current = { width: width ?? 0, height };
  const reportViewport = useRef<((rect: Rect) => void) | null>(null);
  const observeElementRect = useCallback((_instance: unknown, onRect: (rect: Rect) => void) => {
    reportViewport.current = onRect;
    onRect(viewport.current);
    return () => {
      reportViewport.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    reportViewport.current?.({ width: width ?? 0, height });
  }, [width, height]);

  const estimateSize = useCallback(
    (index: number) => (typeof rowHeight === "number" ? rowHeight : rowHeight({ index })),
    [rowHeight]
  );
  const getItemKey = useMemo(() => indexKeyFor(estimateSize), [estimateSize]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: overscanRowCount,
    rangeExtractor,
    initialRect: viewport.current,
    observeElementRect,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToPosition: position => {
        if (scrollRef.current) scrollRef.current.scrollTop = position.scrollTop;
      },
    }),
    []
  );

  useLayoutEffect(() => {
    if (scrollTop !== undefined && scrollRef.current) {
      scrollRef.current.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  // The album pages derive their column count by division, so it can land a hair off an integer;
  // react-virtualized rendered every column index below it, and so does this.
  const renderedColumns = Math.max(0, Math.ceil(columnCount));
  const rows = virtualizer.getVirtualItems();
  const [firstRow, lastRow] = sectionBounds(
    rows.map(row => row.index),
    pinnedRow
  );

  const sectionCallback = useRef(onSectionRendered);
  sectionCallback.current = onSectionRendered;
  // Like react-virtualized, report a range only when it moves, not on every render.
  useEffect(() => {
    if (firstRow < 0 || renderedColumns <= 0) return;
    sectionCallback.current?.({
      rowOverscanStartIndex: firstRow,
      rowOverscanStopIndex: lastRow,
      columnOverscanStartIndex: 0,
      columnOverscanStopIndex: renderedColumns - 1,
    });
  }, [firstRow, lastRow, renderedColumns]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    onScroll?.({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    });
  };

  const totalWidth = columnCount * columnWidth;
  const totalHeight = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollRef}
      className={className}
      // Focusable so the arrow and page keys scroll it, as react-virtualized's Grid was.
      tabIndex={0}
      onScroll={handleScroll}
      onFocus={keepFocusedRowMounted ? handleFocus : undefined}
      style={{
        boxSizing: "border-box",
        direction: "ltr",
        height,
        width: width ?? "100%",
        position: "relative",
        overflow: "auto",
        willChange: "transform",
        WebkitOverflowScrolling: "touch",
        ...style,
      }}
    >
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          width: totalWidth,
          maxWidth: totalWidth,
          height: totalHeight,
          maxHeight: totalHeight,
        }}
      >
        {rows.map(row => {
          const cells = Array.from({ length: renderedColumns }, (_unused, columnIndex) => {
            const key = `${row.index}-${columnIndex}`;
            return (
              <React.Fragment key={key}>
                {cellRenderer({
                  rowIndex: row.index,
                  columnIndex,
                  key,
                  style: {
                    position: "absolute",
                    top: row.start,
                    left: columnIndex * columnWidth,
                    width: columnWidth,
                    height: row.size,
                  },
                })}
              </React.Fragment>
            );
          });
          // A wrapper without a box (display: contents) tells which row a focused cell is in
          return keepFocusedRowMounted ? (
            <div key={row.index} className={classes.row} data-virtual-row={row.index}>
              {cells}
            </div>
          ) : (
            cells
          );
        })}
      </div>
    </div>
  );
});
