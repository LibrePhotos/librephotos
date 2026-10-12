import { useViewportSize } from "@mantine/hooks";
import { useEffect, useState } from "react";
import type { TileGridSizing } from "../components/virtual/TileGrid";
import { FOOTER_HEIGHT, LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../uiConstants";
import { useIsDesktopLayout } from "./useIsDesktopLayout";

/**
 * Left padding the album grids give their scroll container. Each cell pads its tile by 5px,
 * so the tiles sit 10px from the edges, in line with PageHeader's p={10}.
 */
const ALBUM_GRID_GUTTER = 5;

// Around each cover inside its column, so the covers sit 10px apart
const ALBUM_CELL_PADDING = 5;
// Under each cover: the title and the count
const ALBUM_CAPTION_HEIGHT = 60;

// PageHeader above each grid: an icon beside the title and subtitle, 10px padding
// and 10px margin. The grid fills the rest, so the page itself does not scroll as well.
const PAGE_HEADER_HEIGHT = 90;

/**
 * What a classic scrollbar takes from the grid: 0 where scrollbars overlay (phones, macOS).
 * Measured on every resize rather than once: Firefox keeps it at a fixed device-pixel width,
 * so its CSS width changes with page zoom, and a zoom fires resize.
 */
function getScrollbarWidth(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll";
  document.body.appendChild(probe);
  const scrollbarWidth = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return scrollbarWidth;
}

/** Albums per row of an album grid that is `width` px wide. */
export function albumColumnsFor(width: number): number {
  if (width < 600) return 2;
  if (width < 800) return 3;
  if (width < 1000) return 4;
  if (width < 1200) return 5;
  return 6;
}

function calculateGridValues(width: number, navbarShown: boolean): { entries: number; squareSize: number } {
  const entries = albumColumnsFor(width);
  // The gutter on both sides, and room for the grid's own scrollbar only where it takes any:
  // a fixed 15px left the last column 30px short of the edge on phones.
  let columnWidth = width - 2 * ALBUM_GRID_GUTTER - getScrollbarWidth();
  if (navbarShown) {
    columnWidth -= LEFT_MENU_WIDTH;
  }
  return { entries, squareSize: columnWidth / entries };
}

/**
 * The layout of an album index grid (TileGrid): columns from the viewport width beside the
 * navbar, and the height below the page header. `reservedHeight` is taken off for whatever else
 * sits above the grid (the places map), keeping room for at least one row.
 */
export function useAlbumListGridConfig({ reservedHeight }: { reservedHeight?: number } = {}): TileGridSizing {
  const { width, height } = useViewportSize();
  // The AppShell's own test for its navbar (and, below it, the phone footer)
  const navbarShown = useIsDesktopLayout();
  const [entriesPerRow, setEntriesPerRow] = useState(0);
  const [entrySquareSize, setEntrySquareSize] = useState(200);
  const [gridHeight, setGridHeight] = useState(0);

  useEffect(() => {
    const { entries, squareSize } = calculateGridValues(width, navbarShown);
    setEntriesPerRow(entries);
    setEntrySquareSize(squareSize);
    const footer = navbarShown ? 0 : FOOTER_HEIGHT;
    setGridHeight(height - TOP_MENU_HEIGHT - PAGE_HEADER_HEIGHT - footer);
  }, [width, height, navbarShown]);

  const rowHeight = entrySquareSize + ALBUM_CAPTION_HEIGHT;
  return {
    columnCount: entriesPerRow,
    columnWidth: entrySquareSize,
    cellPadding: ALBUM_CELL_PADDING,
    captionHeight: ALBUM_CAPTION_HEIGHT,
    height: reservedHeight === undefined ? gridHeight : Math.max(gridHeight - reservedHeight, rowHeight),
    gutter: ALBUM_GRID_GUTTER,
  };
}
