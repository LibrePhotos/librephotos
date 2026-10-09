import cx from "clsx";
import React, { useCallback } from "react";
import { FacesTab } from "../../api_client/faces/types";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { ScrollerType } from "../scrollscrubber/ScrollScrubberTypes.zod";
import type { ScrollerData } from "../scrollscrubber/ScrollScrubberTypes.zod";
import { AutoSizer } from "../virtual/AutoSizer";
import { VirtualGrid } from "../virtual/VirtualGrid";
import type { GridCellProps, SectionRenderedParams, VirtualGridHandle } from "../virtual/VirtualGrid";
import { FaceComponent } from "./FaceComponent";
import { HeaderComponent } from "./HeaderComponent";
import { FaceCell, FaceSelection, GridCell, GridRows, isLoadedFace, isPersonCell } from "./hooks/useVirtualizedGrid";
import classes from "./VirtualizedGridComponent.module.css";

interface VirtualizedGridComponentProps {
  containerRef: React.Ref<HTMLDivElement>;
  gridRef: React.RefObject<VirtualGridHandle>;
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
}

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
}: VirtualizedGridComponentProps) {
  // Cell renderer for the virtualized grid
  const cellRenderer = useCallback(
    ({ columnIndex, key, rowIndex, style }: GridCellProps) => {
      const cell: GridCell | undefined = getCellContentsForTab(activeTab)[rowIndex]?.[columnIndex];
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
      getCellContentsForTab,
      setSelectedFaces,
      collapsedPersons,
      onToggleCollapse,
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
              className={cx(classes.grid, "scrollscrubbertarget")}
              cellRenderer={cellRenderer}
              columnWidth={entrySquareSize}
              columnCount={numEntrySquaresPerRow}
              rowHeight={entrySquareSize}
              onSectionRendered={onSectionRendered}
              height={height}
              width={gridWidth}
              rowCount={getCellContentsForTab(activeTab).length}
              scrollTop={scrollPosition} // Only defined for programmatic scrolls
              onScroll={onScroll}
            />
          </ScrollScrubber>
        )}
      </AutoSizer>
    </div>
  );
}
