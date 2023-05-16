import { useViewportSize } from "@mantine/hooks";
import { useEffect, useState } from "react";

import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../ui-constants";

interface AlbumGridConfig {
  entriesPerRow: number;
  entrySquareSize: number;
  numberOfRows: number;
  gridHeight: number;
}

function calculateGridValues(width: number): { columnWidth: number; squareSize: number } {
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
  const columnWidth = width - LEFT_MENU_WIDTH - 5 - 5 - 15;
  return { columnWidth, squareSize: columnWidth / entries };
}

export function useAlbumListGridConfig(albums: Object[]): AlbumGridConfig {
  const { width, height } = useViewportSize();
  const [entriesPerRow, setEntriesPerRow] = useState(0);
  const [entrySquareSize, setEntrySquareSize] = useState(200);
  const [numberOfRows, setNumberOfRows] = useState(0);
  const [gridHeight, setGridHeight] = useState(0);

  useEffect(() => {
    const { columnWidth, squareSize } = calculateGridValues(width);
    setEntriesPerRow(columnWidth / squareSize);
    setEntrySquareSize(squareSize);
    setGridHeight(height - TOP_MENU_HEIGHT - 60);
  }, [width, height]);

  useEffect(() => {
    if (albums && albums.length > 0 && entriesPerRow > 0) {
      setNumberOfRows(Math.ceil(albums.length / entriesPerRow));
    }
  }, [albums, entriesPerRow]);

  return { entriesPerRow, entrySquareSize, numberOfRows, gridHeight };
}
