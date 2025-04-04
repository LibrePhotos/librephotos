/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
import { RemoveScroll, Stack } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import _ from "lodash";
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { AutoSizer, Grid, GridCellProps } from "react-virtualized";

import { 
  useFetchIncompleteFacesQuery, 
  useDeleteFacesMutation, 
  useSetFacesPersonLabelMutation,
  queryClient,
  API,
  QueryKeys
} from "../../api_client/tanstack-api";
import { ButtonHeaderGroup } from "../../components/facedashboard/ButtonHeaderGroup";
import { FaceComponent } from "../../components/facedashboard/FaceComponent";
import { HeaderComponent } from "../../components/facedashboard/HeaderComponent";
import { TabComponent } from "../../components/facedashboard/TabComponent";
import { Lightbox } from "../../components/lightbox/Lightbox";
import { ModalPersonEdit } from "../../components/modals/ModalPersonEdit";
import { ScrollScrubber } from "../../components/scrollscrubber/ScrollScrubber";
import { ScrollerType } from "../../components/scrollscrubber/ScrollScrubberTypes.zod";
import type { IScrollerData } from "../../components/scrollscrubber/ScrollScrubberTypes.zod";
import { notification } from "../../service/notifications";
import { 
  FaceAnalysisMethod, 
  FacesTab,
  CompletePersonFaceList
} from "../../store/faces/facesActions.types";
import { useAppDispatch } from "../../store/store";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { calculateFaceGridCellSize, calculateFaceGridCells } from "../../util/gridUtils";

type FaceCell = {
  id: number;
  face_url: string;
  image?: string | null;
  name?: string;
  isTemp?: boolean;
  person?: number;
  photo?: string;
};

type FaceSelection = {
  face_id: number;
  face_url: string;
};

// Default values for URL parameters
const DEFAULT_VALUES = {
  activeTab: FacesTab.enum.labeled,
  analysisMethod: FaceAnalysisMethod.enum.clustering,
  orderBy: 'person',
  minConfidence: 0.9,
};

// Tab scroll positions storage
const DEFAULT_TAB_POSITIONS = {
  [FacesTab.enum.labeled]: 0,
  [FacesTab.enum.inferred]: 0,
  [FacesTab.enum.unknown]: 0,
};

// Utility to parse URL parameters with proper typing
function parseUrlParams(searchParams: URLSearchParams) {
  return {
    activeTab: (searchParams.get('tab') as FacesTab) || DEFAULT_VALUES.activeTab,
    analysisMethod: (searchParams.get('method') as FaceAnalysisMethod) || DEFAULT_VALUES.analysisMethod,
    orderBy: searchParams.get('orderBy') || DEFAULT_VALUES.orderBy,
    minConfidence: parseFloat(searchParams.get('minConfidence') || String(DEFAULT_VALUES.minConfidence)),
  };
}

// Custom hook to manage grid functionality
function useVirtualizedGrid(
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
  clearSelection: () => void,
  analysisMethod: FaceAnalysisMethod,
  width: number
) {
  const gridRef = useRef<any>(null);
  
  // Calculate dimensions based on width
  const { entrySquareSize, numEntrySquaresPerRow } = calculateFaceGridCellSize(width);
  
  // Calculate cell contents for each tab
  const cellContents = {
    [FacesTab.enum.labeled]: calculateFaceGridCells(lists.labeled, numEntrySquaresPerRow).cellContents,
    [FacesTab.enum.inferred]: calculateFaceGridCells(lists.inferred, numEntrySquaresPerRow).cellContents,
    [FacesTab.enum.unknown]: calculateFaceGridCells(lists.unknown, numEntrySquaresPerRow).cellContents,
  };
  
  // Get cell contents for the active tab
  const getCellContentsForTab = useCallback((tab: FacesTab) => 
    cellContents[tab] || [], [cellContents]);
    
  // Helper to find the endpoint cell
  const getEndpointCell = useCallback((cellContents, rowStopIndex, columnStopIndex): FaceCell => {
    if (cellContents[rowStopIndex]?.[columnStopIndex]) {
      return cellContents[rowStopIndex][columnStopIndex];
    }
    return getEndpointCell(cellContents, rowStopIndex, columnStopIndex - 1);
  }, []);
  
  // Calculate grid height
  const gridHeight = gridRef.current ? gridRef.current.getTotalRowsHeight() : 200;
  
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
          setSelectedFaces={clearSelection}
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
    handleCellClick, handleShowClick, selectMode, getCellContentsForTab, clearSelection
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
            scrollToY={onScroll}
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
    scrollPosition, onScroll, onSectionRendered
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

// Custom hook to manage lightbox functionality
function useLightbox() {
  const [lightboxImageId, setLightboxImageId] = useState("");
  const [lightboxShow, setLightboxShow] = useState(false);
  const [scrollLocked, setScrollLocked] = useState(false);

  const showLightbox = useCallback((imageId: string, isValid: boolean) => {
    setLightboxImageId(imageId);
    setLightboxShow(isValid);
    setScrollLocked(isValid);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxShow(false);
    setScrollLocked(false);
  }, []);

  const renderLightbox = useCallback((idx2hash: Array<{ id: string }>) => 
    lightboxShow && (
      <Lightbox
        isPublic={false}
        idx2hash={idx2hash}
        selectedImage={lightboxImageId}
        onChangedIndex={() => {}}
        onCloseRequest={closeLightbox}
      />
    ), [lightboxShow, lightboxImageId, closeLightbox]);

  return {
    showLightbox,
    closeLightbox,
    renderLightbox,
    isLightboxOpen: lightboxShow,
    scrollLocked
  };
}

// Custom hook to manage face selection
function useFaceSelection(getFacesInRange: (start: FaceCell, end: FaceCell) => FaceCell[]) {
  const [lastChecked, setLastChecked] = useState<FaceCell | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<FaceSelection[]>([]);

  const onFacesSelect = useCallback((faces: FaceSelection[]) => {
    setSelectedFaces(prev => {
      const duplicates = faces.filter(face => prev.some(i => i.face_id === face.face_id));
      const merged = _.uniqBy([...prev, ...faces], el => el.face_id);
      
      // If there are no duplicates, add the last checked face to the selection
      if (duplicates.length !== faces.length && lastChecked) {
        const lastSelectedFace = { face_id: lastChecked.id, face_url: lastChecked.face_url };
        return [lastSelectedFace, ...merged.filter(face => !duplicates.some(d => d.face_id === face.face_id))];
      }
      
      return merged.filter(face => !duplicates.some(d => d.face_id === face.face_id));
    });
  }, [lastChecked]);

  const onFaceSelect = useCallback((face: FaceSelection) => {
    setSelectedFaces(prev => 
      prev.some(f => f.face_url === face.face_url)
        ? prev.filter(item => item.face_url !== face.face_url)
        : [...prev, face]
    );
  }, []);
  
  const handleCellClick = useCallback((e, cell) => {
    if (!lastChecked) {
      setLastChecked(cell);
      onFaceSelect({ face_id: cell.id, face_url: cell.face_url });
      return;
    }
    
    if (e.shiftKey) {
      // Get the faces in range between the current cell and lastChecked
      const facesInRange = getFacesInRange(cell, lastChecked);
      
      const facesToSelect = facesInRange
        .filter(face => face && face.image)
        .map(face => ({ face_id: face.id, face_url: face.face_url }));
        
      onFacesSelect(facesToSelect);
      setLastChecked(cell);
      return;
    }
    
    onFaceSelect({ face_id: cell.id, face_url: cell.face_url });
    setLastChecked(cell);
  }, [lastChecked, onFaceSelect, onFacesSelect, setLastChecked, getFacesInRange]);

  return {
    selectedFaces, 
    setSelectedFaces, 
    lastChecked, 
    setLastChecked, 
    onFaceSelect, 
    onFacesSelect,
    handleCellClick,
    clearSelection: useCallback(() => setSelectedFaces([]), [])
  };
}

// Custom hook to manage face data fetching
function useFaceDataFetching(groups, activeTab, analysisMethod, orderBy, minConfidence) {
  // Create params objects for API calls
  const params = {
    labeled: { inferred: false, orderBy },
    inferred: { inferred: true, method: analysisMethod, orderBy, minConfidence }
  };

  // Fetch data for both labeled and inferred categories
  const { 
    data: labeledFacesListUnfiltered = [], 
    isFetching: fetchingLabeledFacesList 
  } = useFetchIncompleteFacesQuery(params.labeled);

  const { 
    data: inferredFacesListUnfiltered = [], 
    isFetching: fetchingInferredFacesList 
  } = useFetchIncompleteFacesQuery(params.inferred);

  // Filter data by category
  const lists = {
    unknown: inferredFacesListUnfiltered.filter(person => person.name === "Unknown - Other"),
    inferred: inferredFacesListUnfiltered.filter(person => person.name !== "Unknown - Other"),
    labeled: labeledFacesListUnfiltered.filter(person => person.name !== "Unknown - Other")
  };

  // Create hash mapping based on active tab
  const idx2hash = lists[activeTab === FacesTab.enum.labeled ? 'labeled' : 
                         activeTab === FacesTab.enum.inferred ? 'inferred' : 'unknown']
    .flatMap(person => person.faces)
    .map(face => ({ id: face.photo }));

  // Fetch detailed face data when groups change
  useEffect(() => {
    if (!groups.length) return;
    
    (async () => {
      for (const element of groups) {
        try {
          const queryParams = {
            person: element.person || 0,
            page: element.page,
            inferred: element.inferred,
            orderBy,
            minConfidence: element.inferred ? minConfidence : undefined,
            method: element.inferred ? element.method : undefined,
          };
          
          // Fetch face data
          const data = await queryClient.fetchQuery({
            queryKey: [QueryKeys.faces, queryParams],
            queryFn: () => API.fetchFaces(queryParams)
          });
          
          // Update cache with fetched data
          const incompleteParams = element.inferred ? params.inferred : params.labeled;
          const incompleteData = queryClient.getQueryData<CompletePersonFaceList>(
            [QueryKeys.incompleteFaces, incompleteParams]
          );
          
          if (incompleteData) {
            queryClient.setQueryData(
              [QueryKeys.incompleteFaces, incompleteParams],
              incompleteData.map(person => 
                person.id === element.person 
                  ? {
                      ...person,
                      faces: person.faces.map((face, idx) => {
                        const dataIndex = idx - (element.page - 1) * 100;
                        return dataIndex >= 0 && dataIndex < data.length
                          ? { ...data[dataIndex], person: element.person }
                          : face;
                      })
                    }
                  : person
              )
            );
          }
        } catch (error) {
          console.error("Error fetching faces:", error);
        }
      }
    })();
  }, [groups, orderBy, minConfidence, analysisMethod, params.inferred, params.labeled]);

  return {
    lists,
    fetchingLabeledFacesList,
    fetchingInferredFacesList,
    idx2hash,
    params
  };
}

// Custom hook to manage tab scroll positions in localStorage
function useTabScrollPositions() {
  const [tabPositions, setTabPositions] = useState(() => {
    try {
      const saved = localStorage.getItem('faceTabScrollPositions');
      return saved ? JSON.parse(saved) : { ...DEFAULT_TAB_POSITIONS };
    } catch (e) {
      console.error('Error loading tab positions from localStorage:', e);
      return { ...DEFAULT_TAB_POSITIONS };
    }
  });

  const updatePosition = useCallback((tab: FacesTab, position: number) => {
    setTabPositions(prev => {
      const newPositions = { ...prev, [tab]: position };
      try {
        localStorage.setItem('faceTabScrollPositions', JSON.stringify(newPositions));
      } catch (e) {
        console.error('Error saving tab positions to localStorage:', e);
      }
      return newPositions;
    });
  }, []);

  return { tabPositions, updatePosition };
}

export function FaceDashboard() {
  const { ref, width } = useElementSize();
  const dispatch = useAppDispatch();
  
  // URL parameters instead of Redux store
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeTab, analysisMethod, orderBy, minConfidence } = parseUrlParams(searchParams);
  
  // Tab scroll positions from localStorage
  const { tabPositions, updatePosition } = useTabScrollPositions();

  // State
  const [modalPersonEditOpen, setModalPersonEditOpen] = useState(false);
  const [scrollTo, setScrollTo] = useState<number | null>(null);
  const [groups, setGroups] = useState<Array<{
    page: number;
    person: number;
    inferred: boolean;
    method: FaceAnalysisMethod;
  }>>([]);

  const {
    lists,
    fetchingLabeledFacesList,
    fetchingInferredFacesList,
    idx2hash
  } = useFaceDataFetching(groups, activeTab, analysisMethod, orderBy, minConfidence);

  const {
    showLightbox,
    renderLightbox,
    scrollLocked
  } = useLightbox();

  // Mutations
  const { mutate: deleteFacesMutate } = useDeleteFacesMutation();
  const { mutate: setFacesPersonLabelMutate } = useSetFacesPersonLabelMutation();

  // Update URL params (replaces Redux dispatch)
  const updateParams = useCallback((updates: Record<string, string>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        newParams.set(key, value);
      } else {
        newParams.delete(key);
      }
    });
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  // Explicitly update the URL when parameters change
  useEffect(() => {
    // This ensures URL params are set on initial render
    const params = {
      tab: activeTab,
      method: analysisMethod,
      orderBy,
      minConfidence: minConfidence.toString()
    };
    
    const newParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        newParams.set(key, value);
      }
    });
    
    // Only update if different to avoid loops
    const currentParams = new URLSearchParams(searchParams);
    let isDifferent = false;
    
    Object.entries(params).forEach(([key, value]) => {
      if (currentParams.get(key) !== value) {
        isDifferent = true;
      }
    });
    
    if (isDifferent) {
      setSearchParams(newParams);
    }
  }, [activeTab, analysisMethod, orderBy, minConfidence, setSearchParams]);

  // Event handlers
  const handleShowClick = useCallback((event: React.KeyboardEvent, item: any) => {
    const index = idx2hash.findIndex(image => image.id === item.photo);
    showLightbox(item.photo, index >= 0);
  }, [idx2hash, showLightbox]);

  const handleGridScroll = useCallback(({ scrollTop }: { scrollTop: number }) => {
    if (scrollTo !== null && scrollTop === scrollTo) {
      setScrollTo(null);
    }
    if (tabPositions[activeTab] !== scrollTop) {
      updatePosition(activeTab, scrollTop);
    }
  }, [scrollTo, tabPositions, activeTab, updatePosition]);

  // Handle tab changes
  const handleTabChange = useCallback((newTab: FacesTab) => {
    updateParams({ tab: newTab });
  }, [updateParams]);

  // Handle analysis method changes (using string type instead of enum)
  const handleMethodChange = useCallback((method: string) => {
    updateParams({ method });
  }, [updateParams]);

  // Handle order changes
  const handleOrderChange = useCallback((newOrderBy: string) => {
    updateParams({ orderBy: newOrderBy });
  }, [updateParams]);

  // Handle confidence changes
  const handleConfidenceChange = useCallback((confidence: number) => {
    updateParams({ minConfidence: confidence.toString() });
  }, [updateParams]);

  // Create grid utilities object that we'll use for selection logic
  const gridUtils = useMemo(() => {
    // We need to initialize with cell calculation functions
    // that will be replaced after the grid is initialized
    const utils = {
      getFlattenedCells: () => [] as FaceCell[],
      getFacesInRange: (start: FaceCell, end: FaceCell) => {
        const allFaces = utils.getFlattenedCells();
        const startIndex = allFaces.indexOf(start);
        const endIndex = allFaces.indexOf(end);
        return allFaces.slice(
          Math.min(startIndex, endIndex), 
          Math.max(startIndex, endIndex) + 1
        );
      }
    };
    return utils;
  }, []);
  
  // Create selection hook with the grid utils
  const { 
    selectedFaces, handleCellClick, clearSelection 
  } = useFaceSelection(gridUtils.getFacesInRange);

  // Initialize the virtualized grid
  const virtualGrid = useVirtualizedGrid(
    ref,
    activeTab,
    lists,
    handleCellClick,
    handleShowClick,
    setGroups,
    tabPositions[activeTab], // Use local storage position instead of Redux
    handleGridScroll,
    selectedFaces.length > 0, // selectMode
    selectedFaces,
    clearSelection,
    analysisMethod,
    width
  );
  
  // Update the grid utilities with actual implementation after grid is initialized
  useEffect(() => {
    gridUtils.getFlattenedCells = virtualGrid.getFlattenedCells;
    gridUtils.getFacesInRange = (start, end) => {
      const allFaces = virtualGrid.getFlattenedCells();
      const startIndex = allFaces.indexOf(start);
      const endIndex = allFaces.indexOf(end);
      return allFaces.slice(
        Math.min(startIndex, endIndex), 
        Math.max(startIndex, endIndex) + 1
      );
    };
  }, [gridUtils, virtualGrid]);

  // Action handlers
  const deleteSelectedFaces = useCallback(() => {
    if (selectedFaces.length > 0) {
      deleteFacesMutate({ faceIds: selectedFaces.map(face => face.face_id) });
      notification.deleteFaces(selectedFaces.length);
      clearSelection();
    }
  }, [selectedFaces, deleteFacesMutate, clearSelection]);

  const notThisPersonFunc = useCallback(() => {
    if (selectedFaces.length > 0) {
      setFacesPersonLabelMutate({ 
        faceIds: selectedFaces.map(face => face.face_id), 
        personName: "Unknown - Other" 
      });
      notification.removeFacesFromPerson(selectedFaces.length);
      clearSelection();
    }
  }, [selectedFaces, setFacesPersonLabelMutate, clearSelection]);

  // Track scroll position based on tab
  useEffect(() => setScrollTo(tabPositions[activeTab]), [activeTab, tabPositions]);

  return (
    <RemoveScroll enabled={scrollLocked}>
      <div style={{ display: "flex", flexFlow: "column", height: `calc(100vh - ${TOP_MENU_HEIGHT}px)` }}>
        <Stack>
          <TabComponent
            width={width}
            fetchingLabeledFacesList={fetchingLabeledFacesList}
            fetchingInferredFacesList={fetchingInferredFacesList}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            analysisMethod={analysisMethod}
            onMethodChange={handleMethodChange}
            orderBy={orderBy}
            onOrderChange={handleOrderChange}
            minConfidence={minConfidence}
            onConfidenceChange={handleConfidenceChange}
          />
          <ButtonHeaderGroup
            selectMode={selectedFaces.length > 0}
            selectedFaces={selectedFaces}
            changeSelectMode={clearSelection}
            addFaces={() => selectedFaces.length > 0 && setModalPersonEditOpen(true)}
            deleteFaces={deleteSelectedFaces}
            notThisPerson={notThisPersonFunc}
            activeTab={activeTab}
            analysisMethod={analysisMethod}
            onMethodChange={handleMethodChange}
            orderBy={orderBy}
            onOrderChange={handleOrderChange}
            minConfidence={minConfidence}
            onConfidenceChange={handleConfidenceChange}
          />
        </Stack>
        {virtualGrid.renderGrid()}
        <ModalPersonEdit
          isOpen={modalPersonEditOpen}
          onRequestClose={() => {
            setModalPersonEditOpen(false);
            clearSelection();
          }}
          selectedFaces={selectedFaces}
        />
        {renderLightbox(idx2hash)}
      </div>
    </RemoveScroll>
  );
}
