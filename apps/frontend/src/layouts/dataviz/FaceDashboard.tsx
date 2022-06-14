import { Stack } from "@mantine/core";
import { useElementSize, useMediaQuery, useViewportSize } from "@mantine/hooks";
import _ from "lodash";
import React, { useEffect, useState } from "react";
import { AutoSizer, Grid } from "react-virtualized";

import { deleteFaces, fetchInferredFacesList, fetchLabeledFacesList } from "../../actions/facesActions";
import { ButtonHeaderGroup } from "../../components/facedashboard/ButtonHeaderGroup";
import { FaceComponent } from "../../components/facedashboard/FaceComponent";
import { HeaderComponent } from "../../components/facedashboard/HeaderComponent";
import { TabComponent } from "../../components/facedashboard/TabComponent";
import { ModalPersonEdit } from "../../components/modals/ModalPersonEdit";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { calculateFaceGridCellSize, calculateFaceGridCells } from "../../util/gridUtils";

export const FaceDashboard = () => {
  const { height } = useViewportSize();
  const { ref, width } = useElementSize();
  const [lastChecked, setLastChecked] = useState(null);
  const [activeItem, setActiveItem] = useState(0);
  const [entrySquareSize, setEntrySquareSize] = useState(200);
  const [numEntrySquaresPerRow, setNumEntrySquaresPerRow] = useState(10);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedFaces, setSelectedFaces] = useState<any[]>([]);
  const [modalPersonEditOpen, setModalPersonEditOpen] = useState(false);

  const matches = useMediaQuery("(min-width: 700px)");
  const [inferredCellContents, setInferredCellContents] = useState<any[]>([]);
  const [labeledCellContents, setLabeledCellContents] = useState<any[]>([]);
  const [inferredGroupedByPersonList, setInferredGroupedByPersonList] = useState<any[]>([]);
  const [labeledGroupedByPersonList, setLabeledGroupedByPersonList] = useState<any[]>([]);

  const { workerAvailability, workerRunningJob } = useAppSelector(store => store.util);
  const { inferredFacesList, labeledFacesList, fetchingLabeledFacesList, fetchingInferredFacesList } = useAppSelector(
    store => store.faces
  );

  const changeTab = number => setActiveItem(number);
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchInferredFacesList());
    dispatch(fetchLabeledFacesList());
  }, [dispatch]);

  useEffect(() => {
    const inferredGroupedByPerson = _.groupBy(inferredFacesList, el => el.person_name);
    const inferredGroupedByPersonList = _.sortBy(_.toPairsIn(inferredGroupedByPerson), el => el[0]).map(el => ({
      person_name: el[0],
      faces: _.reverse(_.sortBy(el[1], el2 => el2.person_label_probability)),
    }));

    const labeledGroupedByPerson = _.groupBy(labeledFacesList, el => el.person_name);
    const labeledGroupedByPersonList = _.sortBy(_.toPairsIn(labeledGroupedByPerson), el => el[0]).map(el => ({
      person_name: el[0],
      faces: el[1],
    }));
    const inferredCellContents = calculateFaceGridCells(
      inferredGroupedByPersonList,
      numEntrySquaresPerRow
    ).cellContents;
    const labeledCellContents = calculateFaceGridCells(labeledGroupedByPersonList, numEntrySquaresPerRow).cellContents;
    setInferredCellContents(inferredCellContents);
    setLabeledCellContents(labeledCellContents);
    setInferredGroupedByPersonList(inferredGroupedByPersonList);
    setLabeledGroupedByPersonList(labeledGroupedByPersonList);
  }, [inferredFacesList, labeledFacesList]);

  useEffect(() => {
    const { entrySquareSize, numEntrySquaresPerRow } = calculateFaceGridCellSize(width);

    setEntrySquareSize(entrySquareSize);
    setNumEntrySquaresPerRow(numEntrySquaresPerRow);

    if (inferredGroupedByPersonList) {
      const inferredCellContents = calculateFaceGridCells(
        inferredGroupedByPersonList,
        numEntrySquaresPerRow
      ).cellContents;
      setInferredCellContents(inferredCellContents);
    }
    if (labeledGroupedByPersonList) {
      const labeledCellContents = calculateFaceGridCells(
        labeledGroupedByPersonList,
        numEntrySquaresPerRow
      ).cellContents;
      setLabeledCellContents(labeledCellContents);
    }
  }, [inferredGroupedByPersonList, labeledGroupedByPersonList, width]);

  const handleClick = (e, cell) => {
    if (!lastChecked) {
      setLastChecked(cell);
      onFaceSelect({ face_id: cell.id, face_url: cell.face_url });
      return;
    }
    if (e.shiftKey) {
      const currentCellsInRowFormat = activeItem === 0 ? labeledCellContents : inferredCellContents;

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
        .filter(i => i && i.id);
      facesToSelect.forEach(face => onFaceSelect({ face_id: face.id, face_url: face.face_url }));
      return;
    }
    onFaceSelect({ face_id: cell.id, face_url: cell.face_url });
    setLastChecked(cell);
  };

  const onFaceSelect = face => {
    var tempSelectedFaces = selectedFaces;
    if (tempSelectedFaces.map(face => face.face_id).includes(face.face_id)) {
      tempSelectedFaces = tempSelectedFaces.filter(item => item.face_id !== face.face_id);
    } else {
      tempSelectedFaces.push(face);
    }
    setSelectedFaces(tempSelectedFaces);
    setSelectMode(tempSelectedFaces.length > 0);
  };

  const changeSelectMode = () => {
    setSelectMode(!selectMode);
  };

  const deleteSelectedFaces = () => {
    if (selectedFaces.length > 0) {
      const ids = selectedFaces.map(face => face.face_id);
      dispatch(deleteFaces(ids));
      setSelectedFaces([]);
      setSelectMode(false);
    }
  };

  const addFaces = () => {
    if (selectedFaces.length > 0) {
      setModalPersonEditOpen(true);
    }
  };

  const cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    let cell;
    if (activeItem === 0) {
      cell = labeledCellContents[rowIndex][columnIndex];
    } else {
      cell = inferredCellContents[rowIndex][columnIndex];
    }

    if (cell) {
      if (!cell.image) {
        return <HeaderComponent key={key} style={style} width={width} cell={cell} entrySquareSize={entrySquareSize} />;
      }
      return (
        <div key={key} style={style}>
          <FaceComponent
            handleClick={handleClick}
            cell={cell}
            isScrollingFast={false}
            selectMode={selectMode}
            isSelected={selectedFaces.map(face => face.face_id).includes(cell.id)}
            activeItem={activeItem}
            entrySquareSize={entrySquareSize}
          />
        </div>
      );
    }
    return <div key={key} style={style} />;
  };
  return (
    <Stack ref={ref}>
      <TabComponent
        width={width}
        activeTab={activeItem}
        changeTab={changeTab}
        fetchingLabeledFacesList={fetchingLabeledFacesList}
        fetchingInferredFacesList={fetchingInferredFacesList}
      />
      <ButtonHeaderGroup
        selectMode={selectMode}
        selectedFaces={selectedFaces}
        workerAvailability={workerAvailability}
        workerRunningJob={workerRunningJob}
        changeSelectMode={changeSelectMode}
        addFaces={addFaces}
        deleteFaces={deleteSelectedFaces}
      />
      <div>
        <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
          {() => (
            <Grid
              style={{ outline: "none" }}
              disableHeader={false}
              cellRenderer={cellRenderer}
              columnWidth={entrySquareSize}
              columnCount={numEntrySquaresPerRow}
              height={height - TOP_MENU_HEIGHT - 40 - 40 - (matches ? 0 : 70)}
              rowHeight={entrySquareSize}
              rowCount={activeItem === 0 ? labeledCellContents.length : inferredCellContents.length}
              width={width}
            />
          )}
        </AutoSizer>
      </div>

      <ModalPersonEdit
        isOpen={modalPersonEditOpen}
        onRequestClose={() => {
          setModalPersonEditOpen(false);
          setSelectedFaces([]);
          setSelectMode(false);
        }}
        selectedFaces={selectedFaces}
      />
    </Stack>
  );
};
