import cx from "clsx";
import React, { useCallback, useMemo } from "react";
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
import type { FaceCell, FaceSelection, GridCell, GridRows } from "./hooks/useVirtualizedGrid";
import { isLoadedFace, isPersonCell } from "./hooks/useVirtualizedGrid";
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
};

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
}: VirtualizedGridComponentProps) {
  const rows = getCellContentsForTab(activeTab);
  // A face's actions depend on its group (person, cluster or unknown), which is the header above it
  const rowGroups = useMemo(() => groupsByRow(rows), [rows]);

  // Cell renderer for the virtualized grid
  const cellRenderer = useCallback(
    ({ columnIndex, key, rowIndex, style }: GridCellProps) => {
      const cell: GridCell | undefined = rows[rowIndex]?.[columnIndex];
      if (!cell) return null;

      if (isPersonCell(cell)) {
        return (
          <HeaderComponent
            key={key}
            style={style}
            cell={cell}
            selectedFaces={selectedFaces}
            setSelectedFaces={setSelectedFaces}
            isCollapsed={collapsedPersons.has(cell.id)}
            onToggleCollapse={() => onToggleCollapse(cell.id)}
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
      onToggleCollapse,
      faceActions,
      pendingFaceIds,
    ]
  );

  return (
    <div className={classes.container} ref={containerRef}>
      <AutoSizer>
        {({ height, width: gridWidth }) => (
          <ScrollScrubber
            scrollPositions={getScrollPositions()}
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
