import React, { useCallback, useRef, useState, useEffect } from "react";
import _ from "lodash";
import { AutoSizer, Grid, GridCellProps } from "react-virtualized";
import { FaceAnalysisMethod, FacesTab } from "../../../api_client/faces/types";
import { FaceComponent } from "../FaceComponent";
import { HeaderComponent } from "../HeaderComponent";
import { calculateFaceGridCellSize, calculateFaceGridCells } from "../../../util/gridUtils";
import { ScrollerType } from "../../scrollscrubber/ScrollScrubberTypes.zod";
import type { IScrollerData } from "../../scrollscrubber/ScrollScrubberTypes.zod";
import { ScrollScrubber } from "../../scrollscrubber/ScrollScrubber";

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

// Custom hook to manage grid functionality
export function useVirtualizedGrid(
  containerRef: React.RefObject<HTMLDivElement>,
  activeTab: FacesTab, 
  lists: { 
    labeled: any[], 
    inferred: any[], 
    unknown: any[] 
  },
  handleCellClick: (e: React.MouseEvent, cell: FaceCell) => void,
  handleShowClick: (e: React.KeyboardEvent, item: any) => void,
  onSectionChange: (visibleInfos: Array<{
    page: number;
    person: number;
    inferred: boolean;
    method: FaceAnalysisMethod;
  }>) => void,
  scrollPosition: number,
  onScroll: (params: { scrollTop: number }) => void,
  selectMode: boolean,
  selectedFaces: FaceSelection[],
  setSelectedFaces: (faces: FaceSelection[]) => void,
  analysisMethod: FaceAnalysisMethod,
  width: number
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
      const { cellContents } = calculateFaceGridCells(lists[activeTab], numEntrySquaresPerRow);
      setGridHeight(cellContents.length * size);
    }
  }, [width, lists, activeTab, numEntrySquaresPerRow]);

  // Handle scroll from scrubber
  const handleScrubberScroll = useCallback((y: number) => {
    if (gridRef.current) {
      gridRef.current.scrollToPosition({ scrollTop: y });
      onScroll({ scrollTop: y });
    }
  }, [onScroll]);

  // Calculate cell contents for each tab
  const cellContents = {
    [FacesTab.enum.labeled]: calculateFaceGridCells(lists.labeled, numEntrySquaresPerRow).cellContents,
    [FacesTab.enum.inferred]: calculateFaceGridCells(lists.inferred, numEntrySquaresPerRow).cellContents,
    [FacesTab.enum.unknown]: calculateFaceGridCells(lists.unknown, numEntrySquaresPerRow).cellContents,
  };
  
  // Get cell contents for the active tab
  const getCellContentsForTab = useCallback((tab: FacesTab) => 
    cellContents[tab] || [], [cellContents]);
    
  // Get endpoint cell for section rendering
  const getEndpointCell = useCallback((cellContents: any[][], rowStopIndex: number, columnStopIndex: number) => {
    if (cellContents[rowStopIndex]?.[columnStopIndex]) {
      return cellContents[rowStopIndex][columnStopIndex];
    }
    return getEndpointCell(cellContents, rowStopIndex, columnStopIndex - 1);
  }, []);
  
  // Generate scroll positions for the scrubber
  const getScrollPositions = useCallback((): IScrollerData[] => {
    const rows = getCellContentsForTab(activeTab);
    return rows.reduce((positions, row, index) => {
      if (row[0]?.name) {
        positions.push({ label: row[0].name, targetY: index * entrySquareSize });
      }
      return positions;
    }, [] as IScrollerData[]);
  }, [activeTab, getCellContentsForTab, entrySquareSize]);
  
  // Handle section rendering and detect visible cells
  const onSectionRendered = useCallback(({ 
    rowOverscanStartIndex, columnOverscanStartIndex,
    rowOverscanStopIndex, columnOverscanStopIndex
  }) => {
    const cellContents = getCellContentsForTab(activeTab);
    const startPoint = cellContents[rowOverscanStartIndex]?.[columnOverscanStartIndex];
    const endPoint = getEndpointCell(cellContents, rowOverscanStopIndex, columnOverscanStopIndex);
    
    if (!startPoint || !endPoint) return;
    
    const flatCells = _.flatten(cellContents);
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
  }, [activeTab, analysisMethod, getCellContentsForTab, getEndpointCell, onSectionChange]);
  
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
  
  // Get flattened cell contents for cell range selection
  const getFlattenedCells = useCallback((): FaceCell[] => {
    return _.flatten(getCellContentsForTab(activeTab));
  }, [activeTab, getCellContentsForTab]);
  
  // Render the grid with AutoSizer
  const renderGrid = useCallback(() => (
    <div style={{ flexGrow: 1, padding: "0 15px" }} ref={containerRef}>
      <AutoSizer>
        {({ height, width: gridWidth }) => (
          <ScrollScrubber
            scrollPositions={getScrollPositions()}
            scrollToY={handleScrubberScroll}
            targetHeight={gridHeight}
            type={ScrollerType.enum.alphabet}
          >
            <Grid
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
      </AutoSizer>
    </div>
  ), [
    containerRef,
    gridHeight, getScrollPositions, cellRenderer, entrySquareSize, 
    numEntrySquaresPerRow, getCellContentsForTab, activeTab, 
    scrollPosition, onScroll, onSectionRendered, handleScrubberScroll
  ]);
  
  return {
    gridRef,
    renderGrid,
    entrySquareSize,
    numEntrySquaresPerRow,
    gridHeight,
    getCellContentsForTab,
    getFlattenedCells
  };
} 