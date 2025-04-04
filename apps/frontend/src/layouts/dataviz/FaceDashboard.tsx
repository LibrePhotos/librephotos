/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
import { Flex, RemoveScroll, Stack } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import _ from "lodash";
import React, { useEffect, useRef, useState } from "react";
import { AutoSizer, Grid } from "react-virtualized";

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
import { faceActions } from "../../store/faces/faceSlice";
import { 
  FaceAnalysisMethod, 
  FacesTab,
  CompletePersonFaceList,
  PersonFaceListRequest 
} from "../../store/faces/facesActions.types";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { calculateFaceGridCellSize, calculateFaceGridCells } from "../../util/gridUtils";

export function FaceDashboard() {
  const { ref, width } = useElementSize();
  const gridRef = useRef<any>();

  const { activeTab, tabs, analysisMethod, orderBy, minConfidence } = useAppSelector(store => store.face);

  const [lastChecked, setLastChecked] = useState(null);
  const [selectedFaces, setSelectedFaces] = useState<any[]>([]);
  const [modalPersonEditOpen, setModalPersonEditOpen] = useState(false);
  const [lightboxImageId, setLightboxImageId] = useState("");
  const [lightboxShow, setLightboxShow] = useState(false);

  const [scrollTo, setScrollTo] = useState<number | null>(null);
  const [scrollLocked, setScrollLocked] = useState(false);

  // Use explicit query keys to ensure proper caching and refetching
  const labeledParams = {
    inferred: false,
    orderBy,
  };

  const inferredParams = {
    inferred: true,
    method: analysisMethod,
    orderBy,
    minConfidence,
  };

  const { data: labeledFacesListUnfiltered = [], isFetching: fetchingLabeledFacesList } = useFetchIncompleteFacesQuery(
    labeledParams
  );

  const { data: inferredFacesListUnfiltered = [], isFetching: fetchingInferredFacesList } = useFetchIncompleteFacesQuery(
    inferredParams
  );

  const unknownFacesList = inferredFacesListUnfiltered.filter(person => person.name === "Unknown - Other");
  const inferredFacesList = inferredFacesListUnfiltered.filter(person => person.name !== "Unknown - Other");
  const labeledFacesList = labeledFacesListUnfiltered.filter(person => person.name !== "Unknown - Other");

  const dispatch = useAppDispatch();

  const [groups, setGroups] = useState<
    {
      page: number;
      person: any;
      inferred: boolean;
      method: FaceAnalysisMethod;
    }[]
  >([]);

  // Fetch face data when groups change
  useEffect(() => {
    const fetchFaces = async () => {
      for (const element of groups) {
        const queryParams: PersonFaceListRequest = {
          person: element.person ? element.person : 0,
          page: element.page,
          inferred: element.inferred,
          orderBy,
          minConfidence: element.inferred ? minConfidence : undefined,
          method: element.inferred ? element.method : undefined,
        };
        
        try {
          // Use fetchQuery instead of prefetchQuery for direct access to results
          const data = await queryClient.fetchQuery({
            queryKey: [QueryKeys.faces, queryParams],
            queryFn: () => API.fetchFaces(queryParams)
          });
          
          // Manually update the incomplete faces cache with the face data
          const incompleteParams = element.inferred ? inferredParams : labeledParams;
          
          const incompleteData = queryClient.getQueryData<CompletePersonFaceList>(
            [QueryKeys.incompleteFaces, incompleteParams]
          );
          
          if (incompleteData) {
            const updatedData = [...incompleteData];
            const personIndex = updatedData.findIndex(person => person.id === element.person);
            
            if (personIndex !== -1) {
              const person = { ...updatedData[personIndex] };
              const startIndex = (element.page - 1) * 100;
              
              // Create a new faces array with the updated data
              const updatedFaces = [...person.faces];
              
              // Replace temporary faces with actual data
              for (let i = 0; i < data.length; i++) {
                if (updatedFaces[startIndex + i]) {
                  updatedFaces[startIndex + i] = { 
                    ...data[i],
                    person: element.person
                  };
                }
              }
              
              person.faces = updatedFaces;
              updatedData[personIndex] = person;
              
              // Update the cache
              queryClient.setQueryData(
                [QueryKeys.incompleteFaces, incompleteParams],
                updatedData
              );
            }
          }
        } catch (error) {
          console.error("Error fetching faces:", error);
        }
      }
    };
    
    if (groups.length > 0) {
      fetchFaces();
    }
  }, [groups, orderBy, minConfidence, analysisMethod, inferredParams, labeledParams]);

  const { entrySquareSize, numEntrySquaresPerRow } = calculateFaceGridCellSize(width);

  const inferredCellContents = calculateFaceGridCells(inferredFacesList, numEntrySquaresPerRow).cellContents;
  const labeledCellContents = calculateFaceGridCells(labeledFacesList, numEntrySquaresPerRow).cellContents;
  const unknownCellContents = calculateFaceGridCells(unknownFacesList, numEntrySquaresPerRow).cellContents;

  const selectMode = selectedFaces.length > 0;

  const { mutate: deleteFacesMutate } = useDeleteFacesMutation();
  const { mutate: setFacesPersonLabelMutate } = useSetFacesPersonLabelMutation();

  let idx2hash: { id: string }[] = [];

  switch (activeTab) {
    case FacesTab.enum.labeled:
      idx2hash = labeledFacesList.flatMap(person => person.faces).map(face => ({ id: face.photo }));
      break;
    case FacesTab.enum.inferred:
      idx2hash = inferredFacesList.flatMap(person => person.faces).map(face => ({ id: face.photo }));
      break;
    case FacesTab.enum.unknown:
      idx2hash = unknownFacesList.flatMap(person => person.faces).map(face => ({ id: face.photo }));
      break;
    default:
      throw new Error("unknown tab", activeTab);
  }

  const getCellContentsForTab = (tab: FacesTab) => {
    if (tab === FacesTab.enum.labeled) {
      return labeledCellContents;
    }
    if (tab === FacesTab.enum.inferred) {
      return inferredCellContents;
    }
    if (tab === FacesTab.enum.unknown) {
      return unknownCellContents;
    }
    throw new Error("unknown tab", tab);
  };

  const handleShowClick = (event: React.KeyboardEvent, item: any) => {
    const index = idx2hash.findIndex(image => image.id === item.photo);
    setLightboxImageId(item.photo);
    setLightboxShow(index >= 0);
    setScrollLocked(true);
  };

  const handleGridScroll = (params: any) => {
    const { scrollTop } = params;
    if (scrollTo !== null && scrollTop === scrollTo) {
      setScrollTo(null);
    }
    if (tabs[activeTab].scrollPosition !== scrollTop) {
      dispatch(
        faceActions.saveCurrentGridPosition({
          tab: activeTab,
          position: scrollTop,
        })
      );
    }
  };

  const getScrollPositions = () => {
    const cellContents = getCellContentsForTab(activeTab);
    let scrollPosition = 0;
    const scrollPositions: IScrollerData[] = [];
    cellContents.forEach(row => {
      if (row[0].name) {
        scrollPositions.push({ label: row[0].name, targetY: scrollPosition });
      }
      scrollPosition += entrySquareSize;
    });
    return scrollPositions;
  };

  const dataForScrollIndicator = getScrollPositions();

  useEffect(() => {
    setScrollTo(tabs[activeTab].scrollPosition);
  }, [activeTab]);

  useEffect(() => {
    if (scrollTo !== null) {
      dispatch(
        faceActions.saveCurrentGridPosition({
          tab: activeTab,
          position: scrollTo,
        })
      );
    }
  }, [scrollTo]);

  // ensure that the endpoint is not undefined
  const getEndpointCell = (cellContents, rowStopIndex, columnStopIndex) => {
    if (cellContents[rowStopIndex][columnStopIndex]) {
      return cellContents[rowStopIndex][columnStopIndex];
    }
    return getEndpointCell(cellContents, rowStopIndex, columnStopIndex - 1);
  };

  const gridHeight = gridRef.current ? gridRef.current.getTotalRowsHeight() : 200;

  const onSectionRendered = (params: any) => {
    const cellContents = getCellContentsForTab(activeTab);
    const startPoint = cellContents[params.rowOverscanStartIndex][params.columnOverscanStartIndex];
    const endPoint = getEndpointCell(cellContents, params.rowOverscanStopIndex, params.columnOverscanStopIndex);
    // flatten labeledCellContents and find the range of cells that are in the viewport
    const flatCellContents = _.flatten(cellContents);
    const startIndex = flatCellContents.findIndex(cell => JSON.stringify(cell) === JSON.stringify(startPoint));
    const endIndex = flatCellContents.findIndex(cell => JSON.stringify(cell) === JSON.stringify(endPoint));

    // get the range of cells that are in the viewport
    const visibleCells = flatCellContents.slice(startIndex, endIndex + 1);
    const relevantInfos = visibleCells
      .filter((i: any) => i.isTemp)
      .map((i: any) => {
        const page = Math.ceil((parseInt(i.id, 10) + 1) / 100);
        return {
          page,
          person: activeTab === FacesTab.enum.unknown ? 0 : i.person,
          inferred: !(activeTab === FacesTab.enum.labeled),
          method: analysisMethod,
        };
      });
    const uniqueGroups = _.uniqBy(relevantInfos, (e: any) => `${e.page} ${e.person}`);
    if (uniqueGroups.length > 0) {
      setGroups(uniqueGroups);
    } else {
      setGroups([]);
    }
  };

  const onFacesSelect = faces => {
    // get duplicates of new faces and selected faces
    const duplicates = faces.filter(face => selectedFaces.find(i => i.face_id === face.face_id));
    // merge selected faces with new faces, filter both duplicates
    const merged = _.uniqBy([...selectedFaces, ...faces], el => el.face_id);
    // filter duplicates from new faces
    const mergedAndFiltered = merged.filter(face => !duplicates.find(i => i.face_id === face.face_id));
    // add the last selected face back to the start of the list when adding new faces
    // @ts-ignore
    const lastSelectedFace = { face_id: lastChecked.id, face_url: lastChecked.face_url };
    const mergedAndFilteredAndLastSelected =
      duplicates.length !== faces.length ? [lastSelectedFace, ...mergedAndFiltered] : mergedAndFiltered;
    setSelectedFaces(mergedAndFilteredAndLastSelected);
  };

  const onFaceSelect = face => {
    let tempSelectedFaces = selectedFaces;
    if (tempSelectedFaces.map(f => f.face_url).includes(face.face_url)) {
      tempSelectedFaces = tempSelectedFaces.filter(item => item.face_url !== face.face_url);
    } else {
      tempSelectedFaces.push(face);
    }
    setSelectedFaces([...tempSelectedFaces]);
  };

  const handleClick = (e, cell) => {
    if (!lastChecked) {
      setLastChecked(cell);
      onFaceSelect({ face_id: cell.id, face_url: cell.face_url });
      return;
    }
    if (e.shiftKey) {
      const currentCellsInRowFormat = getCellContentsForTab(activeTab);
      const allFacesInCells = [] as any[];
      for (let i = 0; i < currentCellsInRowFormat.length; i++) {
        for (let j = 0; j < numEntrySquaresPerRow; j++) {
          allFacesInCells.push(currentCellsInRowFormat[i][j]);
        }
      }
      const start = allFacesInCells.indexOf(cell);
      const end = allFacesInCells.indexOf(lastChecked);

      const facesToSelect = allFacesInCells
        .slice(Math.min(start, end), Math.max(start, end) + 1)
        .filter(i => i && i.image);
      onFacesSelect(facesToSelect.map(i => ({ face_id: i.id, face_url: i.face_url })));
      setLastChecked(cell);
      return;
    }
    onFaceSelect({ face_id: cell.id, face_url: cell.face_url });
    setLastChecked(cell);
  };

  const changeSelectMode = () => {
    if (selectMode) {
      setSelectedFaces([]);
    }
  };

  const deleteSelectedFaces = () => {
    if (selectedFaces.length > 0) {
      const ids = selectedFaces.map(face => face.face_id);
      deleteFacesMutate({ faceIds: ids });
      notification.deleteFaces(ids.length);
      setSelectedFaces([]);
    }
  };

  const addFaces = () => {
    if (selectedFaces.length > 0) {
      setModalPersonEditOpen(true);
    }
  };

  const notThisPersonFunc = () => {
    if (selectedFaces.length > 0) {
      const ids = selectedFaces.map(face => face.face_id);
      setFacesPersonLabelMutate({ faceIds: ids, personName: "Unknown - Other" });
      notification.removeFacesFromPerson(ids.length);
      setSelectedFaces([]);
    }
  };

  const cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    const cellContents = getCellContentsForTab(activeTab);
    const cell = cellContents[rowIndex][columnIndex];

    if (cell) {
      if (cell.name) {
        return (
          <React.Fragment key={key}>
            <HeaderComponent
              style={style}
              width={width}
              cell={cell}
              entrySquareSize={entrySquareSize}
              selectedFaces={selectedFaces}
              setSelectedFaces={setSelectedFaces}
            />
          </React.Fragment>
        );
      }
      if (cell.isTemp) {
        return <div key={key} style={{ ...style, height: entrySquareSize, width: entrySquareSize }} />;
      }

      return (
        <div key={key} style={style}>
          <FaceComponent
            handleClick={handleClick}
            handleShowClick={handleShowClick}
            cell={cell}
            isScrollingFast={false}
            selectMode={selectMode}
            isSelected={selectedFaces.map(face => face.face_id).includes(cell.id)}
            entrySquareSize={entrySquareSize}
          />
        </div>
      );
    }
    return null;
  };

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
            selectMode={selectMode}
            selectedFaces={selectedFaces}
            changeSelectMode={changeSelectMode}
            addFaces={addFaces}
            deleteFaces={deleteSelectedFaces}
            notThisPerson={notThisPersonFunc}
          />
        </Stack>
        <Flex ref={ref} style={{ flexGrow: 1, padding: "0 15px" }}>
          <AutoSizer>
            {({ height, width: gridWidth }) => (
              <ScrollScrubber
                scrollPositions={dataForScrollIndicator}
                scrollToY={setScrollTo}
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
                  scrollTop={tabs[activeTab].scrollPosition}
                  onScroll={handleGridScroll}
                />
              </ScrollScrubber>
            )}
          </AutoSizer>
        </Flex>
        <ModalPersonEdit
          isOpen={modalPersonEditOpen}
          onRequestClose={() => {
            setModalPersonEditOpen(false);
            setSelectedFaces([]);
          }}
          selectedFaces={selectedFaces}
        />
        {lightboxShow && (
          <Lightbox
            isPublic={false}
            idx2hash={idx2hash}
            selectedImage={lightboxImageId}
            onChangedIndex={() => {}}
            onCloseRequest={() => {
              setLightboxShow(false);
              setScrollLocked(false);
            }}
          />
        )}
      </div>
    </RemoveScroll>
  );
}
