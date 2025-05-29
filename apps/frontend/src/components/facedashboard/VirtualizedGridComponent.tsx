import React, { useCallback } from "react";
import { AutoSizer, Grid, GridCellProps } from "react-virtualized";
import { FaceComponent } from "./FaceComponent";
import { HeaderComponent } from "./HeaderComponent";
import { ScrollerType } from "../scrollscrubber/ScrollScrubberTypes.zod";
import type { ScrollerData } from "../scrollscrubber/ScrollScrubberTypes.zod";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { FaceCell, FaceSelection } from "./hooks/useVirtualizedGrid";
import { FacesTab } from "../../api_client/faces/types";

// Cast components to bypass TypeScript issues
const AutoSizerComponent = AutoSizer as any;
const GridComponent = Grid as any;

interface VirtualizedGridComponentProps {
  containerRef: React.RefObject<HTMLDivElement>;
  gridRef: React.MutableRefObject<any>;
  entrySquareSize: number;
  numEntrySquaresPerRow: number;
  gridHeight: number;
  getCellContentsForTab: (tab: FacesTab) => any[][];
  getScrollPositions: () => ScrollerData[];
  handleScrubberScroll: (y: number) => void;
  onSectionRendered: (params: {
    rowOverscanStartIndex: number;
    columnOverscanStartIndex: number;
    rowOverscanStopIndex: number;
    columnOverscanStopIndex: number;
  }) => void;
  scrollPosition: number;
  onScroll: (params: { scrollTop: number }) => void;
  handleCellClick: (e: React.MouseEvent, cell: FaceCell) => void;
  handleShowClick: (e: React.KeyboardEvent, item: any) => void;
  selectMode: boolean;
  selectedFaces: FaceSelection[];
  setSelectedFaces: (faces: FaceSelection[]) => void;
  width: number;
  activeTab: FacesTab;
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
  width,
  activeTab
}: VirtualizedGridComponentProps) {
  
  // Cell renderer for the virtualized grid
  const cellRenderer = useCallback(({ columnIndex, key, rowIndex, style }: GridCellProps) => {
    const cell = getCellContentsForTab(activeTab)[rowIndex]?.[columnIndex];
    if (!cell) return null;

    if (cell.name) {
      return (
        <HeaderComponent
          key={key}
          style={style}
          width={width}
          cell={cell}
          entrySquareSize={entrySquareSize}
          selectedFaces={selectedFaces}
          setSelectedFaces={setSelectedFaces}
        />
      );
    }
    
    if (cell.isTemp) {
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
  }, [
    activeTab, width, entrySquareSize, selectedFaces, 
    handleCellClick, handleShowClick, selectMode, getCellContentsForTab, setSelectedFaces
  ]);

  return (
    <div style={{ flexGrow: 1, padding: "0 15px" }} ref={containerRef}>
      <AutoSizerComponent>
        {({ height, width: gridWidth }) => (
          <ScrollScrubber
            scrollPositions={getScrollPositions()}
            scrollToY={handleScrubberScroll}
            targetHeight={gridHeight}
            type={ScrollerType.enum.alphabet}
          >
            <GridComponent
              ref={gridRef}
              className="scrollscrubbertarget"
              style={{ overflowX: "hidden" }}
              disableHeader={false}
              cellRenderer={cellRenderer}
              columnWidth={entrySquareSize}
              columnCount={numEntrySquaresPerRow}
              rowHeight={entrySquareSize}
              onSectionRendered={onSectionRendered}
              height={height}
              width={gridWidth}
              rowCount={getCellContentsForTab(activeTab).length}
              scrollTop={scrollPosition}
              onScroll={onScroll}
            />
          </ScrollScrubber>
        )}
      </AutoSizerComponent>
    </div>
  );
} 