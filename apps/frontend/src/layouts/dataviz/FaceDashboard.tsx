/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
import { Stack } from "@mantine/core";
import { useElementSize, usePrevious } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import _ from "lodash";
import React, { useEffect, useRef, useState } from "react";
import { AutoSizer, Grid } from "react-virtualized";

import { api, useFetchIncompleteFacesQuery } from "../../api_client/api";
import { ButtonHeaderGroup } from "../../components/facedashboard/ButtonHeaderGroup";
import { FaceComponent } from "../../components/facedashboard/FaceComponent";
import { HeaderComponent } from "../../components/facedashboard/HeaderComponent";
import { TabComponent } from "../../components/facedashboard/TabComponent";
import { ModalPersonEdit } from "../../components/modals/ModalPersonEdit";
import { ScrollScrubber } from "../../components/scrollscrubber/ScrollScrubber";
import { ScrollerType } from "../../components/scrollscrubber/ScrollScrubberTypes.zod";
import type { IScrollerData } from "../../components/scrollscrubber/ScrollScrubberTypes.zod";
import i18n from "../../i18n";
import { faceActions } from "../../store/faces/faceSlice";
import { FacesTab } from "../../store/faces/facesActions.types";
import type { IFacesTab } from "../../store/faces/facesActions.types";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { calculateFaceGridCellSize, calculateFaceGridCells } from "../../util/gridUtils";

export function FaceDashboard() {
  const { ref, width } = useElementSize();
  const gridRef = useRef<any>();
  const [gridHeight, setGridHeight] = useState(200);
  const [currentScrollPosition, setCurrentScrollPosition] = useState(0);
  const [dataForScrollIndicator, setDataForScrollIndicator] = useState<IScrollerData[]>([]);
  const [lastChecked, setLastChecked] = useState(null);
  const [entrySquareSize, setEntrySquareSize] = useState(200);
  const [numEntrySquaresPerRow, setNumEntrySquaresPerRow] = useState(10);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedFaces, setSelectedFaces] = useState<any[]>([]);
  const [modalPersonEditOpen, setModalPersonEditOpen] = useState(false);

  const [inferredCellContents, setInferredCellContents] = useState<any[]>([]);
  const [labeledCellContents, setLabeledCellContents] = useState<any[]>([]);

  const fetchingInferredFacesList = useFetchIncompleteFacesQuery({ inferred: false }).isFetching;
  const fetchingLabeledFacesList = useFetchIncompleteFacesQuery({ inferred: true }).isFetching;
  const dispatch = useAppDispatch();

  const [groups, setGroups] = useState<
    {
      page: number;
      person: any;
    }[]
  >([]);

  const { activeTab, tabs } = useAppSelector(store => store.face);

  const { inferredFacesList, labeledFacesList } = useAppSelector(
    store => store.face,
    (prev, next) => prev.inferredFacesList === next.inferredFacesList && prev.labeledFacesList === next.labeledFacesList
  );

  const { orderBy } = useAppSelector(store => store.face);

  useEffect(() => {
    if (groups) {
      const currentList = activeTab === FacesTab.enum.labeled ? labeledFacesList : inferredFacesList;
      groups.forEach(element => {
        let force = false;
        const personIndex = currentList.findIndex(person => person.id === element.person);
        // Force refetch for persons that have more than 100 faces as we can't be sure all faces were loaded when changing orderBy
        if (personIndex !== -1 && currentList[personIndex].face_count > 100) force = true;
        dispatch(
          api.endpoints.fetchFaces.initiate(
            {
              person: element.person,
              page: element.page,
              inferred: activeTab === FacesTab.enum.inferred,
              orderBy: orderBy,
            },
            { forceRefetch: force }
          )
        );
      });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeTab, groups, orderBy]);

  const previousTab: IFacesTab = usePrevious(activeTab);
  const [scrollTo, setScrollTo] = useState<number | null>(null);

  const handleGridScroll = (params: any) => {
    const { scrollTop } = params;
    if (scrollTo !== null && scrollTop === scrollTo) {
      setScrollTo(null);
    }
    setCurrentScrollPosition(scrollTop);
  };

  useEffect(() => {
    if (previousTab) {
      dispatch(
        faceActions.saveCurrentGridPosition({
          tab: previousTab,
          position: currentScrollPosition,
        })
      );
    }
    setScrollTo(tabs[activeTab].scrollPosition);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeTab, previousTab, tabs]);

  useEffect(() => {
    const cellContents = activeTab === FacesTab.enum.labeled ? labeledCellContents : inferredCellContents;
    let scrollPosition = 0;
    const scrollPositions: IScrollerData[] = [];
    cellContents.forEach(row => {
      if (row[0].name) {
        scrollPositions.push({ label: row[0].name, targetY: scrollPosition });
      }
      scrollPosition += entrySquareSize;
    });
    setDataForScrollIndicator(scrollPositions);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeTab, gridHeight, entrySquareSize]);

  // ensure that the endpoint is not undefined
  const getEndpointCell = (cellContents, rowStopIndex, columnStopIndex) => {
    if (cellContents[rowStopIndex][columnStopIndex]) {
      return cellContents[rowStopIndex][columnStopIndex];
    }
    return getEndpointCell(cellContents, rowStopIndex, columnStopIndex - 1);
  };

  const onSectionRendered = (params: any) => {
    if (gridRef.current) {
      // To-do find a better way to force update gridHeight for scrollscrubber
      setGridHeight(gridRef.current.getTotalRowsHeight());
    }
    const cellContents = activeTab === FacesTab.enum.labeled ? labeledCellContents : inferredCellContents;
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
        return { page: page, person: i.person };
      });
    const uniqueGroups = _.uniqBy(relevantInfos, (e: any) => `${e.page} ${e.person}`);
    if (uniqueGroups.length > 0) {
      setGroups(uniqueGroups);
    }
  };

  useEffect(() => {
    const inferredContents = calculateFaceGridCells(inferredFacesList, numEntrySquaresPerRow).cellContents;
    const labeledContents = calculateFaceGridCells(labeledFacesList, numEntrySquaresPerRow).cellContents;
    setInferredCellContents(inferredContents);
    setLabeledCellContents(labeledContents);
  }, [inferredFacesList, labeledFacesList, numEntrySquaresPerRow, selectedFaces]);

  useEffect(() => {
    const { entrySquareSize: squareSize, numEntrySquaresPerRow: squaresPerRow } = calculateFaceGridCellSize(width);

    setEntrySquareSize(squareSize);
    setNumEntrySquaresPerRow(squaresPerRow);

    if (inferredFacesList) {
      const inferredContents = calculateFaceGridCells(inferredFacesList, squaresPerRow).cellContents;
      setInferredCellContents(inferredContents);
    }
    if (labeledFacesList) {
      const labeledContents = calculateFaceGridCells(labeledFacesList, squaresPerRow).cellContents;
      setLabeledCellContents(labeledContents);
    }
  }, [inferredFacesList, labeledFacesList, selectedFaces, width]);

  useEffect(() => {
    setSelectMode(selectedFaces.length > 0);
  }, [selectedFaces]);

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
      const currentCellsInRowFormat = activeTab === FacesTab.enum.labeled ? labeledCellContents : inferredCellContents;

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
      dispatch(api.endpoints.deleteFaces.initiate({ faceIds: ids }));
      showNotification({
        message: i18n.t<string>("toasts.deletefaces", {
          numberOfFaces: ids.length,
        }),
        title: i18n.t<string>("toasts.deletefacestitle"),
        color: "teal",
      });
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
      dispatch(api.endpoints.setFacesPersonLabel.initiate({ faceIds: ids, personName: "Unknown - Other" }));
      showNotification({
        message: i18n.t<string>("toasts.removefacestoperson", {
          numberOfFaces: ids.length,
        }),
        title: i18n.t<string>("toasts.removefacestopersontitle"),
        color: "teal",
      });
      setSelectedFaces([]);
    }
  };

  const cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    const cell =
      activeTab === FacesTab.enum.labeled
        ? labeledCellContents[rowIndex][columnIndex]
        : inferredCellContents[rowIndex][columnIndex];

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
    <div style={{ display: "flex", flexFlow: "column", height: "100%" }}>
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
      <div ref={ref} style={{ flexGrow: 1 }}>
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
                rowCount={
                  activeTab === FacesTab.enum.labeled ? labeledCellContents.length : inferredCellContents.length
                }
                scrollTop={scrollTo}
                onScroll={handleGridScroll}
              />
            </ScrollScrubber>
          )}
        </AutoSizer>
      </div>
      <ModalPersonEdit
        isOpen={modalPersonEditOpen}
        onRequestClose={() => {
          setModalPersonEditOpen(false);
          setSelectedFaces([]);
        }}
        selectedFaces={selectedFaces}
      />
    </div>
  );
}
