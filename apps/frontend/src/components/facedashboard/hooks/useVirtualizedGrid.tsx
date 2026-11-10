import type { FaceAnalysisMethod } from "@librephotos/api-client";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from "react";
import type { CompletePersonFace, CompletePersonFaceList, PersonFace } from "../../../api_client/faces";
import { uniqBy } from "../../../util/helpers";
import type { ScrollerData } from "../../scrollscrubber/scrollScrubberTypes";
import type { SectionRenderedParams, VirtualGridHandle } from "../../virtual/VirtualGrid";
import { buildFaceGridRows, faceGridLayout, faceRowHeights, layoutWidthOf } from "../faceGridRows";
import { FacesTab } from "../facesTab";
import { PAGE_SIZE } from "./useFaceDataFetching";
import type { FaceGroupPage } from "./useFaceDataFetching";

/** A cell of the faces grid: a person's header, or one of their faces. */
export type GridCell = CompletePersonFace | PersonFace;
/** The grid's rows (see faceGridRows.ts): a shelf row mixes groups and their faces. */
export type GridRows = GridCell[][];

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
 * The page (of its person's faces) that a rendered placeholder face needs. A folded group's tile
 * shows its first faces, so it pages in its first page like any other face (#860).
 */
function pageNeededBy(cell: GridCell): { page: number; person: number } | null {
  // fetchIncompleteFaces gives each placeholder its person's id, and its index as its id
  if (isPersonCell(cell) || !cell.isTemp || typeof cell.person !== "number") return null;
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
  collapsedPersons: Record<FacesTab, ReadonlySet<number>>,
  /** Moves when the slots of the lists change (useFaceDataFetching), not when faces land. */
  listsVersion = ""
) {
  const gridRef = useRef<VirtualGridHandle>(null);
  // The columns and the face size follow the grid's measured width
  const layout = useMemo(() => faceGridLayout(layoutWidthOf(width)), [width]);

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
    (): Record<FacesTab, GridRows> => ({
      [FacesTab.enum.labeled]: buildFaceGridRows(lists.labeled, layout, collapsedPersons[FacesTab.enum.labeled]),
      [FacesTab.enum.inferred]: buildFaceGridRows(lists.inferred, layout, collapsedPersons[FacesTab.enum.inferred]),
      [FacesTab.enum.unknown]: buildFaceGridRows(lists.unknown, layout, collapsedPersons[FacesTab.enum.unknown]),
      [FacesTab.enum.deleted]: buildFaceGridRows(lists.deleted, layout, collapsedPersons[FacesTab.enum.deleted]),
    }),
    [lists.labeled, lists.inferred, lists.unknown, lists.deleted, layout, collapsedPersons]
  );

  // Get cell contents for the active tab - stable reference due to memoized cellContents
  const getCellContentsForTab = useCallback((tab: FacesTab): GridRows => cellContents[tab] || [], [cellContents]);

  // Where each row of the active tab starts, and the whole grid's height
  const rowOffsets = useMemo(() => {
    const heights = faceRowHeights(cellContents[activeTab], layout);
    const offsets: number[] = [];
    let top = 0;
    for (const height of heights) {
      offsets.push(top);
      top += height;
    }
    return { offsets, total: top };
  }, [cellContents, activeTab, layout]);
  const gridHeight = rowOffsets.total;

  // Generate scroll positions for the scrubber
  const getScrollPositions = useCallback((): ScrollerData[] => {
    const rows = getCellContentsForTab(activeTab);
    return rows.reduce<ScrollerData[]>((positions, row, index) => {
      const first: GridCell | undefined = row[0];
      if (first && isPersonCell(first) && first.name) {
        positions.push({ label: first.name, targetY: rowOffsets.offsets[index] ?? 0 });
      }
      return positions;
    }, []);
  }, [activeTab, getCellContentsForTab, rowOffsets]);

  // Request the pages backing the placeholder cells of a rendered section. A row is rendered whole
  // (a shelf of cards is one row), so the section is its rows, whatever its columns.
  const requestPagesForSection = useCallback(
    ({ rowOverscanStartIndex, rowOverscanStopIndex }: RenderedSection) => {
      const cells = getCellContentsForTab(activeTab);
      const sectionCells = cells.slice(rowOverscanStartIndex, rowOverscanStopIndex + 1).flat();

      const relevantInfos = sectionCells.flatMap(cell => {
        const needed = pageNeededBy(cell);
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
    [activeTab, analysisMethod, getCellContentsForTab, onSectionChange]
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
  // A fold, a refetch or a face edit changes the cells behind a fixed range: a scroll moves the
  // range and the Grid reports it. Reacting to every data change here would re-request the pages
  // that just landed, so listsVersion only moves when the slots do (useFaceDataFetching); the
  // replay reads the current cells and tab.
  useEffect(() => {
    replayLastSection();
  }, [collapsedPersons, listsVersion]);

  // Get flattened cell contents for cell range selection
  const getFlattenedCells = useCallback(
    (): GridCell[] => getCellContentsForTab(activeTab).flat(),
    [activeTab, getCellContentsForTab]
  );

  return {
    gridRef,
    layout,
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
