import type { FaceAnalysisMethod } from "@librephotos/api-client";
import { flatten, uniqBy } from "lodash-es";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { CompletePersonFace, CompletePersonFaceList, PersonFace } from "../../../api_client/faces";
import { calculateFaceGridCells, calculateFaceGridCellSize } from "../../../util/gridUtils";
import type { GroupedGridRows } from "../../../util/gridUtils";
import type { ScrollerData } from "../../scrollscrubber/scrollScrubberTypes";
import type { SectionRenderedParams, VirtualGridHandle } from "../../virtual/VirtualGrid";
import { FacesTab } from "../facesTab";
import { needsCoverPage } from "../personCover";
import { PAGE_SIZE } from "./useFaceDataFetching";
import type { FaceGroupPage } from "./useFaceDataFetching";

/** A cell of the faces grid: a person's header, or one of their faces. */
export type GridCell = CompletePersonFace | PersonFace;
export type GridRows = GroupedGridRows<CompletePersonFace, PersonFace>;

/**
 * A face that has been paged in. Until then a face is a placeholder (`isTemp`): no image or URL yet,
 * and its index in the person's list as its id. A paged-in face can still lack its crop (`image`
 * and `face_url` null, #2636): it is a face like any other, shown without one.
 */
export type FaceCell = PersonFace;

export type FaceSelection = {
  face_id: number;
  /** null for a face without a crop (#2636). */
  face_url: string | null;
};

/** What a selection keeps of a face. */
export const selectionOf = (face: FaceCell): FaceSelection => ({ face_id: face.id, face_url: face.face_url ?? null });

/** Header cells are the people; faces have a person_name, not a name. */
export function isPersonCell(cell: GridCell): cell is CompletePersonFace {
  return "name" in cell;
}

/** A face that has been paged in, with or without its crop (#2636). */
export function isLoadedFace(cell: GridCell): cell is FaceCell {
  return !isPersonCell(cell) && !cell.isTemp;
}

type RenderedSection = SectionRenderedParams;

/**
 * The page (of its person's faces) that a rendered cell needs: a placeholder face its own page, a
 * collapsed cluster the first page, for its cover face (#860).
 */
function pageNeededBy(cell: GridCell, collapsed: ReadonlySet<number>): { page: number; person: number } | null {
  if (isPersonCell(cell)) {
    return collapsed.has(cell.id) && needsCoverPage(cell) ? { page: 1, person: cell.id } : null;
  }
  // fetchIncompleteFaces gives each placeholder its person's id, and its index as its id
  if (!cell.isTemp || typeof cell.person !== "number") return null;
  return { page: Math.ceil((cell.id + 1) / PAGE_SIZE), person: cell.person };
}

// Custom hook to manage grid functionality
export function useVirtualizedGrid(
  activeTab: FacesTab,
  lists: Readonly<Record<FacesTab, CompletePersonFaceList>>,
  handleCellClick: (e: React.MouseEvent, cell: FaceCell) => void,
  handleShowClick: (e: React.MouseEvent, cell: FaceCell) => void,
  onSectionChange: (visibleInfos: FaceGroupPage[]) => void,
  scrollPosition: number | undefined, // Only defined for programmatic scrolls (tab changes)
  onScroll: (params: { scrollTop: number }) => void,
  selectMode: boolean,
  selectedFaces: FaceSelection[],
  setSelectedFaces: (faces: FaceSelection[]) => void,
  analysisMethod: FaceAnalysisMethod,
  width: number,
  collapsedPersons: Record<FacesTab, ReadonlySet<number>>
) {
  const gridRef = useRef<VirtualGridHandle>(null);
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
      [FacesTab.enum.deleted]: calculateFaceGridCells(
        lists.deleted,
        numEntrySquaresPerRow,
        collapsedPersons[FacesTab.enum.deleted]
      ).cellContents,
    }),
    [lists.labeled, lists.inferred, lists.unknown, lists.deleted, numEntrySquaresPerRow, collapsedPersons]
  );

  // Get cell contents for the active tab - stable reference due to memoized cellContents
  const getCellContentsForTab = useCallback((tab: FacesTab): GridRows => cellContents[tab] || [], [cellContents]);

  // Get endpoint cell for section rendering
  const getEndpointCell = useCallback(
    (cells: GridRows, rowStopIndex: number, columnStopIndex: number): GridCell | undefined => {
      if (columnStopIndex < 0) {
        return undefined;
      }
      const cell: GridCell | undefined = cells[rowStopIndex]?.[columnStopIndex];
      if (cell) {
        return cell;
      }
      return getEndpointCell(cells, rowStopIndex, columnStopIndex - 1);
    },
    []
  );

  // Generate scroll positions for the scrubber
  const getScrollPositions = useCallback((): ScrollerData[] => {
    const rows = getCellContentsForTab(activeTab);
    return rows.reduce<ScrollerData[]>((positions, row, index) => {
      const first: GridCell | undefined = row[0];
      if (first && isPersonCell(first) && first.name) {
        positions.push({ label: first.name, targetY: index * entrySquareSize });
      }
      return positions;
    }, []);
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
      const startPoint: GridCell | undefined = cells[rowOverscanStartIndex]?.[columnOverscanStartIndex];
      const endPoint = getEndpointCell(cells, rowOverscanStopIndex, columnOverscanStopIndex);

      if (!startPoint || !endPoint) return;

      const flatCells = flatten<GridCell>(cells);
      const startIndex = flatCells.indexOf(startPoint);
      const endIndex = flatCells.indexOf(endPoint);

      const relevantInfos = flatCells.slice(startIndex, endIndex + 1).flatMap(cell => {
        const needed = pageNeededBy(cell, collapsedPersons[activeTab]);
        return needed
          ? [
              {
                page: needed.page,
                person: activeTab === FacesTab.enum.unknown ? 0 : needed.person,
                inferred: activeTab === FacesTab.enum.inferred || activeTab === FacesTab.enum.unknown,
                method: analysisMethod,
                deleted: activeTab === FacesTab.enum.deleted,
              },
            ]
          : [];
      });

      onSectionChange(uniqBy(relevantInfos, e => `${e.page} ${e.person}`));
    },
    [activeTab, analysisMethod, collapsedPersons, getCellContentsForTab, getEndpointCell, onSectionChange]
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
  const replayLastSection = useEffectEvent(() => {
    const section = lastRenderedSection.current;
    const rowCount = getCellContentsForTab(activeTab).length;
    if (!section || rowCount === 0) return;

    requestPagesForSection({
      ...section,
      rowOverscanStartIndex: Math.min(section.rowOverscanStartIndex, rowCount - 1),
      rowOverscanStopIndex: Math.min(section.rowOverscanStopIndex, rowCount - 1),
    });
  });
  // Only a fold changes the cells behind a fixed range: a scroll moves the range and the Grid
  // reports it, and reacting to data arriving here would re-request the pages that just landed.
  // So collapsedPersons is the only trigger; the replay reads the current cells and tab.
  useEffect(() => {
    replayLastSection();
  }, [collapsedPersons]);

  // Get flattened cell contents for cell range selection
  const getFlattenedCells = useCallback(
    (): GridCell[] => flatten<GridCell>(getCellContentsForTab(activeTab)),
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
