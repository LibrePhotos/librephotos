import { RemoveScroll, Stack } from "@mantine/core";
import { IconFaceId } from "@tabler/icons-react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { debounce } from "lodash-es";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FaceAnalysisMethod,
  FacesTab,
  useDeleteFacesMutation,
  useSetFacesPersonLabelMutation,
} from "../../api_client/faces";
import { notification } from "../../service/notifications";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { EmptyState } from "../common/EmptyState";
import { Lightbox } from "../lightbox";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { useContentBoxSize } from "../virtual/useContentBoxSize";
import { HeaderButtons } from "./HeaderButtons";
import { useCollapsedPersons } from "./hooks/useCollapsedPersons";
import { useFaceDataFetching } from "./hooks/useFaceDataFetching";
import { useFaceSelection } from "./hooks/useFaceSelection";
import { useTabScrollPositions } from "./hooks/useTabScrollPositions";
import { useVirtualizedGrid } from "./hooks/useVirtualizedGrid";
import { TabComponent } from "./TabComponent";
import { VirtualizedGridComponent } from "./VirtualizedGridComponent";

const routeApi = getRouteApi("/_protected/faces");

export function FaceDashboard() {
  // Columns are laid out in the grid's content box (the container pads it), so size them from that
  const { ref, width } = useContentBoxSize<HTMLDivElement>();
  const { t } = useTranslation();

  const navigate = useNavigate();
  const search = routeApi.useSearch();
  const { tab: activeTab, method: analysisMethod, orderBy, minConfidence } = search;

  // Tab scroll positions from localStorage
  const { tabPositions, updatePosition } = useTabScrollPositions();

  // Folded person groups from localStorage
  const { collapsedPersons, toggleCollapsed, setCollapsedForTab } = useCollapsedPersons();

  // State
  const [modalPersonEditOpen, setModalPersonEditOpen] = useState(false);
  const [scrollTo, setScrollTo] = useState<number | null>(null);
  const [groups, setGroups] = useState<
    Array<{
      page: number;
      person: number;
      inferred: boolean;
      method: FaceAnalysisMethod;
    }>
  >([]);

  // Simple lightbox state management
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImageId, setLightboxImageId] = useState("");

  const { lists, fetchingLabeledFacesList, fetchingInferredFacesList, idx2hash } = useFaceDataFetching(
    groups,
    activeTab,
    analysisMethod,
    orderBy as any,
    minConfidence
  );

  const showLightbox = useCallback((imageId: string, isValid: boolean) => {
    if (isValid) {
      setLightboxImageId(imageId);
      setLightboxOpen(true);
    }
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setLightboxImageId("");
  }, []);

  // Mutations
  const { mutate: deleteFacesMutate } = useDeleteFacesMutation();
  const { mutate: setFacesPersonLabelMutate } = useSetFacesPersonLabelMutation();

  // Event handlers
  const handleShowClick = useCallback(
    (event: React.KeyboardEvent, item: any) => {
      const index = idx2hash.findIndex(image => image.id === item.photo);
      showLightbox(item.photo, index >= 0);
    },
    [idx2hash, showLightbox]
  );

  // Debounced localStorage save - doesn't trigger re-renders, just persists position
  const debouncedSavePosition = useRef(
    debounce((tab: FacesTab, pos: number) => {
      updatePosition(tab, pos);
    }, 300)
  ).current;

  // Track scroll position in ref (no re-renders) for persistence only
  const currentScrollTop = useRef(0);

  const handleGridScroll = useCallback(
    ({ scrollTop }: { scrollTop: number }) => {
      currentScrollTop.current = scrollTop;

      // Clear scrollTo once we've reached the target (for programmatic scrolls)
      if (scrollTo !== null && scrollTop === scrollTo) {
        setScrollTo(null);
      }
      // Debounced save to localStorage - no state update, no re-render
      debouncedSavePosition(activeTab, scrollTop);
    },
    [scrollTo, activeTab, debouncedSavePosition]
  );

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
        return allFaces.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
      },
    };
    return utils;
  }, []);

  // Create selection hook with the grid utils
  const { selectedFaces, handleCellClick, clearSelection, setSelectedFaces } = useFaceSelection(
    gridUtils.getFacesInRange
  );

  // Initialize the virtualized grid
  // Only pass scrollTo for programmatic scrolling (tab switches), not tabPositions
  // The Grid manages its own scroll position during user scrolling
  const virtualGrid = useVirtualizedGrid(
    activeTab,
    lists,
    handleCellClick,
    handleShowClick,
    setGroups,
    scrollTo ?? undefined, // Only pass when we want to programmatically scroll
    handleGridScroll,
    selectedFaces.length > 0, // selectMode
    selectedFaces,
    setSelectedFaces,
    analysisMethod,
    width,
    collapsedPersons
  );

  const handleToggleCollapse = useCallback(
    (personId: number) => toggleCollapsed(activeTab, personId),
    [activeTab, toggleCollapsed]
  );

  // Update the grid utilities with actual implementation after grid is initialized
  useEffect(() => {
    gridUtils.getFlattenedCells = virtualGrid.getFlattenedCells;
    gridUtils.getFacesInRange = (start, end) => {
      const allFaces = virtualGrid.getFlattenedCells();
      const startIndex = allFaces.indexOf(start);
      const endIndex = allFaces.indexOf(end);
      return allFaces.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
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
        personName: "Unknown - Other",
      });
      notification.removeFacesFromPerson(selectedFaces.length);
      clearSelection();
    }
  }, [selectedFaces, setFacesPersonLabelMutate, clearSelection]);

  // Restore scroll position only on tab change (not when tabPositions updates)
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      // Tab changed - restore the saved scroll position for the new tab
      setScrollTo(tabPositions[activeTab]);
      // The tabs show different faces: a selection carried over would let Delete,
      // Not this person and Add act on faces that are no longer on screen
      clearSelection();
      prevTabRef.current = activeTab;
    }
  }, [activeTab, tabPositions, clearSelection]);

  const handleLightboxImageChange = useCallback((imageId: string) => {
    setLightboxImageId(imageId);
  }, []);

  // Check if the current tab has any faces
  const isFetching = activeTab === FacesTab.enum.labeled ? fetchingLabeledFacesList : fetchingInferredFacesList;
  const currentTabList =
    activeTab === FacesTab.enum.labeled
      ? lists.labeled
      : activeTab === FacesTab.enum.inferred
        ? lists.inferred
        : lists.unknown;
  const hasFaces = currentTabList.length > 0;
  const collapsedInActiveTab = collapsedPersons[activeTab];
  const allCollapsed = hasFaces && currentTabList.every(person => collapsedInActiveTab.has(person.id));

  const toggleAllCollapsed = useCallback(() => {
    setCollapsedForTab(activeTab, allCollapsed ? [] : currentTabList.map(person => person.id));
  }, [activeTab, allCollapsed, currentTabList, setCollapsedForTab]);

  // "Scan your photos" only fits when no tab has any face. Otherwise only this tab
  // is empty (e.g. every face is labeled), so offer the tab that has faces instead.
  const renderEmptyState = () => {
    const noFacesAtAll =
      !fetchingLabeledFacesList &&
      !fetchingInferredFacesList &&
      lists.labeled.length + lists.inferred.length + lists.unknown.length === 0;
    if (noFacesAtAll) {
      return (
        <EmptyState
          icon={<IconFaceId size={40} />}
          title={t("emptystate.faces.title")}
          description={t("emptystate.faces.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      );
    }
    const otherTab = FacesTab.options.find(tab => tab !== activeTab && lists[tab].length > 0);
    return (
      <EmptyState
        icon={<IconFaceId size={40} />}
        title={t(`emptystate.facesTab.${activeTab}.title`)}
        description={t(`emptystate.facesTab.${activeTab}.description`)}
        actionLabel={otherTab && t(`emptystate.facesTab.show.${otherTab}`)}
        onAction={otherTab && (() => navigate({ to: "/faces", search: { ...search, tab: otherTab } }))}
      />
    );
  };

  return (
    <RemoveScroll enabled={lightboxOpen}>
      <Stack h={`calc(100vh - ${TOP_MENU_HEIGHT}px)`}>
        <TabComponent
          fetchingLabeledFacesList={fetchingLabeledFacesList}
          fetchingInferredFacesList={fetchingInferredFacesList}
        />
        <HeaderButtons
          selectMode={selectedFaces.length > 0}
          selectedFaces={selectedFaces}
          changeSelectMode={clearSelection}
          addFaces={() => selectedFaces.length > 0 && setModalPersonEditOpen(true)}
          deleteFaces={deleteSelectedFaces}
          notThisPerson={notThisPersonFunc}
          allCollapsed={allCollapsed}
          toggleAllCollapsed={toggleAllCollapsed}
          canCollapse={hasFaces}
        />
        {!isFetching && !hasFaces ? (
          renderEmptyState()
        ) : (
          <VirtualizedGridComponent
            containerRef={ref}
            gridRef={virtualGrid.gridRef}
            entrySquareSize={virtualGrid.entrySquareSize}
            numEntrySquaresPerRow={virtualGrid.numEntrySquaresPerRow}
            gridHeight={virtualGrid.gridHeight}
            getCellContentsForTab={virtualGrid.getCellContentsForTab}
            getScrollPositions={virtualGrid.getScrollPositions}
            handleScrubberScroll={virtualGrid.handleScrubberScroll}
            onSectionRendered={virtualGrid.onSectionRendered}
            scrollPosition={virtualGrid.scrollPosition}
            onScroll={virtualGrid.onScroll}
            handleCellClick={virtualGrid.handleCellClick}
            handleShowClick={virtualGrid.handleShowClick}
            selectMode={virtualGrid.selectMode}
            selectedFaces={virtualGrid.selectedFaces}
            setSelectedFaces={virtualGrid.setSelectedFaces}
            activeTab={activeTab}
            collapsedPersons={collapsedInActiveTab}
            onToggleCollapse={handleToggleCollapse}
          />
        )}
        <ModalPersonEdit
          isOpen={modalPersonEditOpen}
          onRequestClose={() => {
            setModalPersonEditOpen(false);
            clearSelection();
          }}
          selectedFaces={selectedFaces}
        />
        {lightboxOpen && (
          <Lightbox
            isPublic={false}
            idx2hash={idx2hash}
            selectedImage={lightboxImageId}
            onChangedIndex={() => {}}
            onCloseRequest={closeLightbox}
            onImageChange={handleLightboxImageChange}
          />
        )}
      </Stack>
    </RemoveScroll>
  );
}
