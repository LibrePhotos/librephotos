import { useElementSize, useMergedRef, useViewportSize } from "@mantine/hooks";
import type { TileGridSizing } from "./TileGrid";

type Options = Readonly<{
  /** Columns for a grid this many px wide. */
  columnsFor: (width: number) => number;
  cellPadding: number;
  captionHeight: number;
  /** What sits above the grid (top menu, page header, tabs): the grid takes the rest of the viewport. */
  reservedHeight: number;
}>;

/**
 * The layout of a TileGrid that sizes its columns from the width its own container gets, so they
 * fit a page with padding or tabs around the grid and follow a resize. Put the returned ref on the
 * element that holds the grid.
 */
export function useMeasuredTileSizing({ columnsFor, cellPadding, captionHeight, reservedHeight }: Options) {
  // The element size reads 0 until its first measurement.
  const { ref: sizeRef, width } = useElementSize<HTMLDivElement>();
  // Mantine types its ref for React 19 (RefObject<T | null>); a callback ref fills the same object.
  const ref = useMergedRef(sizeRef);
  const viewportHeight = useViewportSize().height || window.innerHeight;
  // Less room for the grid's own scrollbar
  const gridWidth = (width || window.innerWidth) - 20;
  const columnCount = columnsFor(gridWidth);
  const sizing: TileGridSizing = {
    columnCount,
    columnWidth: gridWidth / columnCount,
    cellPadding,
    captionHeight,
    height: viewportHeight - reservedHeight,
    gutter: 0,
  };
  return { ref, sizing };
}
