import { useMantineTheme } from "@mantine/core";
import { useMediaQuery, useViewportSize } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { FOOTER_HEIGHT, LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../ui-constants";

interface AlbumGridConfig {
  entriesPerRow: number;
  entrySquareSize: number;
  numberOfRows: number;
  gridHeight: number;
}

/**
 * Left padding the album grids give their scroll container. Each cell pads its tile by 5px,
 * so the tiles sit 10px from the edges, in line with HeaderComponent's p={10}.
 */
export const ALBUM_GRID_GUTTER = 5;

// HeaderComponent above each grid: a 50px icon beside the title and subtitle, 10px padding
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

function calculateGridValues(width: number, navbarShown: boolean): { entries: number; squareSize: number } {
  let entries = 6;
  if (width < 600) {
    entries = 2;
  } else if (width < 800) {
    entries = 3;
  } else if (width < 1000) {
    entries = 4;
  } else if (width < 1200) {
    entries = 5;
  }
  // The gutter on both sides, and room for the grid's own scrollbar only where it takes any:
  // a fixed 15px left the last column 30px short of the edge on phones.
  let columnWidth = width - 2 * ALBUM_GRID_GUTTER - getScrollbarWidth();
  if (navbarShown) {
    columnWidth -= LEFT_MENU_WIDTH;
  }
  return { entries, squareSize: columnWidth / entries };
}

export function useAlbumListGridConfig(albums: Object[]): AlbumGridConfig {
  const { width, height } = useViewportSize();
  const theme = useMantineTheme();
  // The AppShell's own test for its navbar (and, below it, the phone footer). The sm breakpoint
  // is in em, so a larger browser font size moves it above a fixed 768px.
  const navbarShown = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`, undefined, {
    getInitialValueInEffect: false,
  });
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

  // Derived on every render, so a list that shrinks (or empties) never keeps a stale row count
  const numberOfRows = entriesPerRow > 0 ? Math.ceil(albums.length / entriesPerRow) : 0;

  return { entriesPerRow, entrySquareSize, numberOfRows, gridHeight };
}
