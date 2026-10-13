import cx from "clsx";
import React, { useCallback, useMemo, useState } from "react";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { SCROLL_SCRUBBER_TARGET } from "../scrollscrubber/scrollScrubberTarget";
import { ScrollerType } from "../scrollscrubber/scrollScrubberTypes";
import type { ScrollerData } from "../scrollscrubber/scrollScrubberTypes";
import { AutoSizer } from "../virtual/AutoSizer";
import { VirtualGrid } from "../virtual/VirtualGrid";
import type { GridCellProps, SectionRenderedParams, VirtualGridHandle } from "../virtual/VirtualGrid";
import { groupsByRow } from "./faceActionRules";
import type { FaceActionHandlers } from "./faceActionRules";
import { FaceComponent } from "./FaceComponent";
import type { FacesTab } from "./facesTab";
import { HeaderComponent } from "./HeaderComponent";
import { usePeopleCovers } from "./hooks/usePeopleCovers";
import type { FaceCell, FaceSelection, GridCell, GridRows } from "./hooks/useVirtualizedGrid";
import { isLoadedFace, isPersonCell } from "./hooks/useVirtualizedGrid";
import { PersonCell } from "./PersonCell";
import { coverFaceUrl } from "./personCover";
import classes from "./VirtualizedGridComponent.module.css";

type VirtualizedGridComponentProps = {
  containerRef: React.Ref<HTMLDivElement>;
  gridRef: React.RefObject<VirtualGridHandle | null>;
  entrySquareSize: number;
  numEntrySquaresPerRow: number;
  gridHeight: number;
  getCellContentsForTab: (tab: FacesTab) => GridRows;
  getScrollPositions: () => ScrollerData[];
  handleScrubberScroll: (y: number) => void;
  onSectionRendered: (params: SectionRenderedParams) => void;
  scrollPosition: number | undefined;
  onScroll: (params: { scrollTop: number }) => void;
  handleCellClick: (e: React.MouseEvent, cell: FaceCell) => void;
  handleShowClick: (e: React.MouseEvent, cell: FaceCell) => void;
  selectMode: boolean;
  selectedFaces: FaceSelection[];
  setSelectedFaces: (faces: FaceSelection[]) => void;
  activeTab: FacesTab;
  collapsedPersons: ReadonlySet<number>;
  onToggleCollapse: (personId: number) => void;
  faceActions: FaceActionHandlers;
  pendingFaceIds: ReadonlySet<number>;
  /** The A-Z scrubber only fits the name order (#764). */
  showScrubber: boolean;
};

const NO_SCROLL_POSITIONS: ScrollerData[] = [];

export function VirtualizedGridComponent({
  containerRef,
  gridRef,
  entrySquareSize,
  numEntrySquaresPerRow,
  gridHeight,
  getCellContentsForTab,
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
  activeTab,
  collapsedPersons,
  onToggleCollapse,
  faceActions,
  pendingFaceIds,
  showScrubber,
}: VirtualizedGridComponentProps) {
  const rows = getCellContentsForTab(activeTab);
  // The People page's cover of each person, for the headers and the grid of people (#860)
  const ownCovers = usePeopleCovers();
  // Folding swaps a person's header for a cell (and back): the person whose new control takes focus
  const [focusPerson, setFocusPerson] = useState<number | null>(null);
  const toggleCollapse = useCallback(
    (personId: number) => {
      setFocusPerson(personId);
      onToggleCollapse(personId);
    },
    [onToggleCollapse]
  );
  const focusTaken = useCallback(() => setFocusPerson(null), []);
  // A face's actions depend on its group (person, cluster or unknown), which is the header above it
  const rowGroups = useMemo(() => groupsByRow(rows), [rows]);

  // Cell renderer for the virtualized grid
  const cellRenderer = useCallback(
    ({ columnIndex, key, rowIndex, style }: GridCellProps) => {
      const cell: GridCell | undefined = rows[rowIndex]?.[columnIndex];
      if (!cell) return null;

      if (isPersonCell(cell)) {
        const coverUrl = coverFaceUrl(cell, ownCovers.get(cell.id));
        // A collapsed person is one cell of a grid of people (#860)
        return collapsedPersons.has(cell.id) ? (
          <PersonCell
            key={key}
            style={style}
            person={cell}
            coverUrl={coverUrl}
            entrySquareSize={entrySquareSize}
            onExpand={() => toggleCollapse(cell.id)}
            takeFocus={focusPerson === cell.id}
            onFocused={focusTaken}
          />
        ) : (
          <HeaderComponent
            key={key}
            style={style}
            cell={cell}
            selectedFaces={selectedFaces}
            setSelectedFaces={setSelectedFaces}
            onToggleCollapse={() => toggleCollapse(cell.id)}
            coverUrl={coverUrl}
            takeFocus={focusPerson === cell.id}
            onFocused={focusTaken}
          />
        );
      }

      // A placeholder until its page has loaded
      if (!isLoadedFace(cell)) {
        return <div key={key} style={{ ...style, height: entrySquareSize, width: entrySquareSize }} />;
      }

      return (
        <div key={key} style={style}>
          <FaceComponent
            handleClick={handleCellClick}
            handleShowClick={handleShowClick}
            cell={cell}
            group={rowGroups[rowIndex]}
            tab={activeTab}
            actions={faceActions}
            pending={pendingFaceIds.has(cell.id)}
            isScrollingFast={false}
            selectMode={selectMode}
            isSelected={selectedFaces.some(face => face.face_id === cell.id)}
            entrySquareSize={entrySquareSize}
          />
        </div>
      );
    },
    [
      activeTab,
      entrySquareSize,
      selectedFaces,
      handleCellClick,
      handleShowClick,
      selectMode,
      rows,
      rowGroups,
      setSelectedFaces,
      collapsedPersons,
      toggleCollapse,
      focusPerson,
      focusTaken,
      ownCovers,
      faceActions,
      pendingFaceIds,
    ]
  );

  return (
    <div className={classes.container} ref={containerRef}>
      <AutoSizer>
        {({ height, width: gridWidth }) => (
          <ScrollScrubber
            scrollPositions={showScrubber ? getScrollPositions() : NO_SCROLL_POSITIONS}
            scrollToY={handleScrubberScroll}
            targetHeight={gridHeight}
            type={ScrollerType.enum.alphabet}
          >
            <VirtualGrid
              ref={gridRef}
              className={cx(classes.grid, SCROLL_SCRUBBER_TARGET)}
              cellRenderer={cellRenderer}
              columnWidth={entrySquareSize}
              columnCount={numEntrySquaresPerRow}
              rowHeight={entrySquareSize}
              onSectionRendered={onSectionRendered}
              height={height}
              width={gridWidth}
              rowCount={rows.length}
              scrollTop={scrollPosition} // Only defined for programmatic scrolls
              onScroll={onScroll}
              // The face menus and buttons are focusable: scrolling away from one keeps it
              keepFocusedRowMounted
            />
          </ScrollScrubber>
        )}
      </AutoSizer>
    </div>
  );
}
