import { RemoveScroll, Stack } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { getRouteApi, useNavigate, useParams, useSearch } from "@tanstack/react-router";

import { 
  useDeleteFacesMutation, 
  useSetFacesPersonLabelMutation
} from "../../api_client/faces";
import { ButtonHeaderGroup } from "./ButtonHeaderGroup";
import { TabComponent } from "./TabComponent";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { notification } from "../../service/notifications";
import { 
  FaceAnalysisMethod, 
  FacesTab
} from "../../api_client/faces/types";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { useVirtualizedGrid } from "./hooks/useVirtualizedGrid";
import { useLightbox } from "./hooks/useLightbox";
import { useFaceSelection } from "./hooks/useFaceSelection";
import { useFaceDataFetching } from "./hooks/useFaceDataFetching";
import { useTabScrollPositions } from "./hooks/useTabScrollPositions";

const routeApi = getRouteApi("/_protected/faces")

export function FaceDashboard() {
  const { ref, width } = useElementSize();
  
  const { tab: activeTab, method: analysisMethod, orderBy, minConfidence } = routeApi.useSearch()
  
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
  } = useFaceDataFetching(groups, activeTab, analysisMethod, orderBy as any, minConfidence);

  const {
    showLightbox,
    renderLightbox,
    scrollLocked
  } = useLightbox();

  // Mutations
  const { mutate: deleteFacesMutate } = useDeleteFacesMutation();
  const { mutate: setFacesPersonLabelMutate } = useSetFacesPersonLabelMutation();

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



  // Create grid utilities object that we'll use for selection logic
  const gridUtils = useMemo(() => {
    // We need to initialize with cell calculation functions
    // that will be replaced after the grid is initialized
    const utils = {
      getFlattenedCells: () => [] as any[],
      getFacesInRange: (start: any, end: any) => {
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
    selectedFaces, handleCellClick, clearSelection, setSelectedFaces 
  } = useFaceSelection(gridUtils.getFacesInRange);

  // Initialize the virtualized grid
  const virtualGrid = useVirtualizedGrid(
    ref,
    activeTab,
    lists,
    handleCellClick,
    handleShowClick,
    setGroups,
    tabPositions[activeTab], // Use local storage position
    handleGridScroll,
    selectedFaces.length > 0, // selectMode
    selectedFaces,
    setSelectedFaces,
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
          />
          <ButtonHeaderGroup
            selectMode={selectedFaces.length > 0}
            selectedFaces={selectedFaces}
            changeSelectMode={clearSelection}
            addFaces={() => selectedFaces.length > 0 && setModalPersonEditOpen(true)}
            deleteFaces={deleteSelectedFaces}
            notThisPerson={notThisPersonFunc}
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