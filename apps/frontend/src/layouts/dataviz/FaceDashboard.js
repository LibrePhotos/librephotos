import React, { Component } from "react";
import { Label } from "semantic-ui-react";

import { connect } from "react-redux";
import {
  deleteFaces,
  trainFaces,
  fetchInferredFacesList,
  fetchLabeledFacesList,
} from "../../actions/facesActions";
import _ from "lodash";
import { Grid, AutoSizer } from "react-virtualized";
import {
  calculateFaceGridCellSize,
  calculateFaceGridCells,
} from "../../util/gridUtils";
import { ScrollSpeed, SCROLL_DEBOUNCE_DURATION } from "../../util/scrollUtils";
import debounce from "lodash/debounce";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { ModalPersonEdit } from "../../components/modals/ModalPersonEdit";
import { FaceComponent } from "../../components/facedashboard/FaceComponent";
import { HeaderComponent } from "../../components/facedashboard/HeaderComponent";
import { TabComponent } from "../../components/facedashboard/TabComponent";
import { ButtonHeaderGroup } from "../../components/facedashboard/ButtonHeaderGroup";
var SIDEBAR_WIDTH = 85;

const SPEED_THRESHOLD = 500;

export class FaceDashboard extends Component {
  state = {
    lastChecked: null,
    activeItem: "labeled",
    entrySquareSize: 200,
    numEntrySquaresPerRow: 10,
    height: 0,
    selectMode: false,
    selectedFaces: [],
    modalPersonEditOpen: false,
    topRowPersonName: null,
  };

  changeTab = (e, { name }) => this.setState({ activeItem: name });

  scrollSpeedHandler = new ScrollSpeed();

  handleScroll = ({ scrollTop }) => {
    // scrollSpeed represents the number of pixels scrolled since the last scroll event was fired
    const scrollSpeed = Math.abs(
      this.scrollSpeedHandler.getScrollSpeed(scrollTop)
    );

    if (scrollSpeed >= SPEED_THRESHOLD) {
      this.setState({
        isScrollingFast: true,
        scrollTop: scrollTop,
      });
    }

    // Since this method is debounced, it will only fire once scrolling has stopped for the duration of SCROLL_DEBOUNCE_DURATION
    this.handleScrollEnd();
  };

  handleScrollEnd = debounce(() => {
    const { isScrollingFast } = this.state;

    if (isScrollingFast) {
      this.setState({
        isScrollingFast: false,
      });
    }
  }, SCROLL_DEBOUNCE_DURATION);

  componentDidMount() {
    this.props.dispatch(fetchInferredFacesList());
    this.props.dispatch(fetchLabeledFacesList());
    this.handleResize();
    window.addEventListener("resize", this.handleResize.bind(this));
    this.handleClick = this.handleClick.bind(this);
    this.changeTab = this.changeTab.bind(this);
    this.deleteFaces = this.deleteFaces.bind(this);
    this.addFaces = this.addFaces.bind(this);
    this.changeSelectMode = this.changeSelectMode.bind(this);
    this.trainFaces = this.trainFaces.bind(this);
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    var inferredGroupedByPerson = _.groupBy(
      nextProps.inferredFacesList,
      (el) => el.person_name
    );
    var inferredGroupedByPersonList = _.sortBy(
      _.toPairsIn(inferredGroupedByPerson),
      (el) => el[0]
    ).map((el) => {
      return {
        person_name: el[0],
        faces: _.reverse(
          _.sortBy(el[1], (el2) => el2.person_label_probability)
        ),
      };
    });

    var labeledGroupedByPerson = _.groupBy(
      nextProps.labeledFacesList,
      (el) => el.person_name
    );
    var labeledGroupedByPersonList = _.sortBy(
      _.toPairsIn(labeledGroupedByPerson),
      (el) => el[0]
    ).map((el) => {
      return { person_name: el[0], faces: el[1] };
    });
    const inferredCellContents = calculateFaceGridCells(
      inferredGroupedByPersonList,
      prevState.numEntrySquaresPerRow
    ).cellContents;
    const labeledCellContents = calculateFaceGridCells(
      labeledGroupedByPersonList,
      prevState.numEntrySquaresPerRow
    ).cellContents;
    const nextState = {
      ...prevState,
      inferredCellContents,
      labeledCellContents,
      inferredGroupedByPersonList,
      labeledGroupedByPersonList,
    };
    return nextState;
  }

  handleResize() {
    var columnWidth = window.innerWidth - 5 - 5 - 10;
    if (this.props.showSidebar) {
      columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10;
    }

    const { entrySquareSize, numEntrySquaresPerRow } =
      calculateFaceGridCellSize(columnWidth);

    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow,
    });

    if (this.state.inferredGroupedByPersonList) {
      const inferredCellContents = calculateFaceGridCells(
        this.state.inferredGroupedByPersonList,
        numEntrySquaresPerRow
      ).cellContents;
      this.setState({
        inferredCellContents,
      });
    }
    if (this.state.labeledGroupedByPersonList) {
      const labeledCellContents = calculateFaceGridCells(
        this.state.labeledGroupedByPersonList,
        numEntrySquaresPerRow
      ).cellContents;
      this.setState({
        labeledCellContents,
      });
    }
  }

  handleClick(e, cell) {
    if (!this.state.lastChecked) {
      this.setState({ lastChecked: cell });
      this.onFaceSelect(cell.id);
      return;
    }
    if (e.shiftKey) {
      var currentCellsInRowFormat =
        this.state.activeItem === "labeled"
          ? this.state.labeledCellContents
          : this.state.inferredCellContents;

      var allFacesInCells = [];
      for (var i = 0; i < currentCellsInRowFormat.length; i++) {
        for (var j = 0; j < this.state.numEntrySquaresPerRow; j++) {
          allFacesInCells.push(currentCellsInRowFormat[i][j]);
        }
      }
      var start = allFacesInCells.indexOf(cell);
      var end = allFacesInCells.indexOf(this.state.lastChecked);

      var facesToSelect = allFacesInCells.slice(
        Math.min(start, end),
        Math.max(start, end) + 1
      );
      facesToSelect.forEach((face) => this.onFaceSelect(face.id));
      return;
    }
    this.onFaceSelect(cell.id);
    this.setState({ lastChecked: cell });
  }

  onFaceSelect(faceID) {
    var selectedFaces = this.state.selectedFaces;
    if (selectedFaces.includes(faceID)) {
      selectedFaces = selectedFaces.filter((item) => item !== faceID);
    } else {
      selectedFaces.push(faceID);
    }
    this.setState({ selectedFaces: selectedFaces });
    this.setState({ selectMode: selectedFaces.length > 0 });
  }

  changeSelectMode() {
    this.setState({ selectMode: !this.state.selectMode });
  }

  addFaces() {
    if (this.state.selectedFaces.length > 0) {
      this.setState({ modalPersonEditOpen: true });
    }
  }

  deleteFaces() {
    this.props.dispatch(deleteFaces(this.state.selectedFaces));
    this.setState({ selectedFaces: [] });
  }

  trainFaces() {
    this.props.dispatch(trainFaces());
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var cell;
    if (this.state.activeItem === "labeled") {
      cell = this.state.labeledCellContents[rowIndex][columnIndex];
    } else {
      cell = this.state.inferredCellContents[rowIndex][columnIndex];
    }

    if (cell) {
      if (!cell.image) {
        return (
          <HeaderComponent
            key={key}
            cell={cell}
            style={style}
            entrySquareSize={this.state.entrySquareSize}
            width={this.state.width}
          />
        );
      } else {
        return (
          <FaceComponent
            handleClick={this.handleClick}
            key={key}
            cell={cell}
            selectMode={this.state.selectMode}
            isSelected={this.state.selectedFaces.includes(cell.id)}
            isScrollingFast={this.state.isScrollingFast}
            activeItem={this.state.activeItem}
            style={style}
            entrySquareSize={this.state.entrySquareSize}
          />
        );
      }
    } else {
      return <div key={key} style={style} />;
    }
  };

  render() {
    const { activeItem } = this.state;
    return (
      <div>
        <TabComponent
          activeTab={activeItem}
          changeTab={this.changeTab}
          fetchingLabeledFacesList={this.state.fetchingLabeledFacesList}
          fetchingInferredFacesList={this.state.fetchingInferredFacesList}
        />
        <div
          style={{
            right: 0,
            top: TOP_MENU_HEIGHT,
            position: "fixed",
            padding: 5,
          }}
        >
          <Label basic>{this.state.topRowPersonName}</Label>
        </div>
        <ButtonHeaderGroup
          selectMode={this.state.selectMode}
          selectedFaces={this.state.selectedFaces}
          workerAvailability={this.props.workerAvailability}
          workerRunningJob={this.props.workerRunningJob}
          changeSelectMode={this.changeSelectMode}
          addFaces={this.addFaces}
          deleteFaces={this.deleteFaces}
          trainFaces={this.trainFaces}
        />
        <div>
          <AutoSizer
            disableHeight
            style={{ outline: "none", padding: 0, margin: 0 }}
          >
            {({ width }) => (
              <Grid
                style={{ outline: "none" }}
                onScroll={this.handleScroll}
                disableHeader={false}
                onSectionRendered={({ rowStartIndex }) => {
                  if (activeItem === "labeled") {
                    this.setState({
                      topRowPersonName:
                        this.state.labeledCellContents[rowStartIndex][0]
                          .person_name,
                    });
                  } else {
                    this.setState({
                      topRowPersonName:
                        this.state.inferredCellContents[rowStartIndex][0]
                          .person_name,
                    });
                  }
                }}
                cellRenderer={this.cellRenderer}
                columnWidth={this.state.entrySquareSize}
                columnCount={this.state.numEntrySquaresPerRow}
                height={this.state.height - TOP_MENU_HEIGHT - 40 - 40}
                rowHeight={this.state.entrySquareSize}
                rowCount={
                  activeItem === "labeled"
                    ? this.state.labeledCellContents.length
                    : this.state.inferredCellContents.length
                }
                width={width}
              />
            )}
          </AutoSizer>
        </div>

        <ModalPersonEdit
          isOpen={this.state.modalPersonEditOpen}
          onRequestClose={() => {
            this.setState({
              modalPersonEditOpen: false,
              selectedFaces: [],
            });
          }}
          selectedFaces={this.state.selectedFaces}
        />
      </div>
    );
  }
}

FaceDashboard = connect((store) => {
  return {
    workerAvailability: store.util.workerAvailability,
    workerRunningJob: store.util.workerRunningJob,
    showSidebar: store.ui.showSidebar,
    inferredFacesList: store.faces.inferredFacesList,
    labeledFacesList: store.faces.labeledFacesList,
    fetchingLabeledFacesList: store.faces.fetchingLabeledFacesList,
    fetchedLabeledFacesList: store.faces.fetchedLabeledFacesList,
    fetchingInferredFacesList: store.faces.fetchingInferredFacesList,
    fetchedInferredFacesList: store.faces.fetchedInferredFacesList,
  };
})(FaceDashboard);
