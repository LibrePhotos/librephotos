import { useViewportSize } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../ui-constants";

interface AlbumGridConfig {
  entriesPerRow: number;
  entrySquareSize: number;
  numberOfRows: number;
  gridHeight: number;
}

function calculateGridValues(width: number): { entries: number; squareSize: number } {
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
  let columnWidth = width - 5 - 5 - 15;
  if (width >= 700) {
    columnWidth -= LEFT_MENU_WIDTH;
  }
  return { entries, squareSize: columnWidth / entries };
}

export function useAlbumListGridConfig(albums: Object[]): AlbumGridConfig {
  const { width, height } = useViewportSize();
  const [entriesPerRow, setEntriesPerRow] = useState(0);
  const [entrySquareSize, setEntrySquareSize] = useState(200);
  const [gridHeight, setGridHeight] = useState(0);

  useEffect(() => {
    const { entries, squareSize } = calculateGridValues(width);
    setEntriesPerRow(entries);
    setEntrySquareSize(squareSize);
    setGridHeight(height - TOP_MENU_HEIGHT - 60);
  }, [width, height]);

  // Derived on every render, so a list that shrinks (or empties) never keeps a stale row count
  const numberOfRows = entriesPerRow > 0 ? Math.ceil(albums.length / entriesPerRow) : 0;

  return { entriesPerRow, entrySquareSize, numberOfRows, gridHeight };
}
