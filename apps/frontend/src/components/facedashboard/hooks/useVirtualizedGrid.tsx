import _ from "lodash";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaceAnalysisMethod, FacesTab } from "../../../api_client/faces";
import { calculateFaceGridCells, calculateFaceGridCellSize } from "../../../util/gridUtils";
import type { ScrollerData } from "../../scrollscrubber/ScrollScrubberTypes.zod";

export type FaceCell = {
  id: number;
  face_url: string;
  image?: string | null;
  name?: string;
  isTemp?: boolean;
  person?: number;
  photo?: string;
};

export type FaceSelection = {
  face_id: number;
  face_url: string;
};

type RenderedSection = {
  rowOverscanStartIndex: number;
  columnOverscanStartIndex: number;
  rowOverscanStopIndex: number;
  columnOverscanStopIndex: number;
};

// Custom hook to manage grid functionality
export function useVirtualizedGrid(
  activeTab: FacesTab,
  lists: {
    labeled: any[];
    inferred: any[];
    unknown: any[];
  },
  handleCellClick: (e: React.MouseEvent, cell: FaceCell) => void,
  handleShowClick: (e: React.KeyboardEvent, item: any) => void,
  onSectionChange: (
    visibleInfos: Array<{
      page: number;
      person: number;
      inferred: boolean;
      method: FaceAnalysisMethod;
    }>
  ) => void,
  scrollPosition: number | undefined, // Only defined for programmatic scrolls (tab changes)
  onScroll: (params: { scrollTop: number }) => void,
  selectMode: boolean,
  selectedFaces: FaceSelection[],
  setSelectedFaces: (faces: FaceSelection[]) => void,
  analysisMethod: FaceAnalysisMethod,
  width: number,
  collapsedPersons: Record<FacesTab, ReadonlySet<number>>
) {
  const gridRef = useRef<any>(null);
  const [gridHeight, setGridHeight] = useState(0);
  const [entrySquareSize, setEntrySquareSize] = useState(0);
  const [numEntrySquaresPerRow, setNumEntrySquaresPerRow] = useState(0);

  // Calculate grid dimensions
  useEffect(() => {
    if (width > 0) {
      const { entrySquareSize: size } = calculateFaceGridCellSize(width);
      setEntrySquareSize(size);
      setNumEntrySquaresPerRow(Math.floor(width / size));
      const { cellContents } = calculateFaceGridCells(
        lists[activeTab],
        numEntrySquaresPerRow,
        collapsedPersons[activeTab]
      );
      setGridHeight(cellContents.length * size);
    }
  }, [width, lists, activeTab, numEntrySquaresPerRow, collapsedPersons]);

  // Handle scroll from scrubber
  const handleScrubberScroll = useCallback(
    (y: number) => {
      if (gridRef.current) {
        gridRef.current.scrollToPosition({ scrollTop: y });
        onScroll({ scrollTop: y });
      }
    },
    [onScroll]
  );

  // Calculate cell contents for each tab - MEMOIZED to prevent recalculation on every render
  const cellContents = useMemo(
    () => ({
      [FacesTab.enum.labeled]: calculateFaceGridCells(
        lists.labeled,
        numEntrySquaresPerRow,
        collapsedPersons[FacesTab.enum.labeled]
      ).cellContents,
      [FacesTab.enum.inferred]: calculateFaceGridCells(
        lists.inferred,
        numEntrySquaresPerRow,
        collapsedPersons[FacesTab.enum.inferred]
      ).cellContents,
      [FacesTab.enum.unknown]: calculateFaceGridCells(
        lists.unknown,
        numEntrySquaresPerRow,
        collapsedPersons[FacesTab.enum.unknown]
      ).cellContents,
    }),
    [lists.labeled, lists.inferred, lists.unknown, numEntrySquaresPerRow, collapsedPersons]
  );

  // Get cell contents for the active tab - stable reference due to memoized cellContents
  const getCellContentsForTab = useCallback((tab: FacesTab) => cellContents[tab] || [], [cellContents]);

  // Get endpoint cell for section rendering
  const getEndpointCell = useCallback((cells: any[][], rowStopIndex: number, columnStopIndex: number) => {
    if (columnStopIndex < 0) {
      return undefined;
    }
    if (cells[rowStopIndex]?.[columnStopIndex]) {
      return cells[rowStopIndex][columnStopIndex];
    }
    return getEndpointCell(cells, rowStopIndex, columnStopIndex - 1);
  }, []);

  // Generate scroll positions for the scrubber
  const getScrollPositions = useCallback((): ScrollerData[] => {
    const rows = getCellContentsForTab(activeTab);
    return rows.reduce((positions, row, index) => {
      if (row[0]?.name) {
        positions.push({ label: row[0].name, targetY: index * entrySquareSize });
      }
      return positions;
    }, [] as ScrollerData[]);
  }, [activeTab, getCellContentsForTab, entrySquareSize]);

  // Request the pages backing the placeholder cells of a rendered section
  const requestPagesForSection = useCallback(
    ({
      rowOverscanStartIndex,
      columnOverscanStartIndex,
      rowOverscanStopIndex,
      columnOverscanStopIndex,
    }: RenderedSection) => {
      const cells = getCellContentsForTab(activeTab);
      const startPoint = cells[rowOverscanStartIndex]?.[columnOverscanStartIndex];
      const endPoint = getEndpointCell(cells, rowOverscanStopIndex, columnOverscanStopIndex);

      if (!startPoint || !endPoint) return;

      const flatCells = _.flatten(cells);
      const startIndex = flatCells.indexOf(startPoint);
      const endIndex = flatCells.indexOf(endPoint);

      const relevantInfos = flatCells
        .slice(startIndex, endIndex + 1)
        .filter((i: any) => i?.isTemp)
        .map(i => ({
          page: Math.ceil((parseInt(i.id, 10) + 1) / 100),
          person: activeTab === FacesTab.enum.unknown ? 0 : i.person,
          inferred: activeTab !== FacesTab.enum.labeled,
          method: analysisMethod,
        }));

      onSectionChange(_.uniqBy(relevantInfos, e => `${e.page} ${e.person}`));
    },
    [activeTab, analysisMethod, getCellContentsForTab, getEndpointCell, onSectionChange]
  );

  // Handle section rendering and detect visible cells
  const lastRenderedSection = useRef<RenderedSection | null>(null);
  const onSectionRendered = useCallback(
    (section: RenderedSection) => {
      lastRenderedSection.current = section;
      requestPagesForSection(section);
    },
    [requestPagesForSection]
  );

  // The Grid memoizes onSectionRendered on the overscan index range, and folding a group moves
  // other people's cells into that unchanged range instead of moving the range. Replay the last
  // section ourselves so the faces a fold reveals are still paged in.
  useEffect(() => {
    const section = lastRenderedSection.current;
    const rowCount = getCellContentsForTab(activeTab).length;
    if (!section || rowCount === 0) return;

    requestPagesForSection({
      ...section,
      rowOverscanStartIndex: Math.min(section.rowOverscanStartIndex, rowCount - 1),
      rowOverscanStopIndex: Math.min(section.rowOverscanStopIndex, rowCount - 1),
    });
    // Only a fold changes the cells behind a fixed range - a scroll moves the range and the Grid
    // reports it, and reacting to data arriving here would re-request the pages that just landed
  }, [collapsedPersons]);

  // Get flattened cell contents for cell range selection
  const getFlattenedCells = useCallback(
    (): FaceCell[] => _.flatten(getCellContentsForTab(activeTab)),
    [activeTab, getCellContentsForTab]
  );

  return {
    gridRef,
    entrySquareSize,
    numEntrySquaresPerRow,
    gridHeight,
    getCellContentsForTab,
    getFlattenedCells,
    getScrollPositions,
    handleScrubberScroll,
    onSectionRendered,
    scrollPosition,
    onScroll,
    handleCellClick,
    handleShowClick,
    selectMode,
    selectedFaces,
    setSelectedFaces,
    width,
  };
}
