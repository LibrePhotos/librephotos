import React, { Component } from "react";
import {
  Checkbox,
  Popup,
  Input,
  Item,
  Menu,
  Image,
  Icon,
  Header,
  Container,
  Divider,
  Button,
  Label,
  Loader,
  Sticky,
  Accordion
} from "semantic-ui-react";

import {SecuredImageJWT} from '../components/SecuredImage'

import {
  FaceToLabel,
  FacesLabeled,
  FacesInferred,
  FaceStatistics,
  FaceTableLabeled,
  FaceTableInferred
} from "../components/faces";
import FaceClusterScatter from "../components/faceClusterGraph";
import { connect } from "react-redux";
import {
  deleteFaces,
  setFacesPersonLabel,
  loadFaceToLabel,
  trainFaces,
  clusterFaces,
  fetchInferredFacesList,
  fetchLabeledFacesList,
  fetchFacesList
} from "../actions/facesActions";
import LazyLoad from "react-lazyload";
import _ from "lodash";
import { Grid, List, WindowScroller, AutoSizer } from "react-virtualized";
import {
  calculateFaceGridCellSize,
  calculateFaceGridCells
} from "../util/gridUtils";
import { ScrollSpeed, SCROLL_DEBOUNCE_DURATION } from "../util/scrollUtils";
import debounce from "lodash/debounce";
import { fetchPeople, addPerson } from "../actions/peopleActions";
import { serverAddress } from "../api_client/apiClient";
import Modal from "react-modal";
import moment from "moment";
// <Icon name='id badge' circular />
var topMenuHeight = 45; // don't change this
var leftMenuWidth = 85; // don't change this
var SIDEBAR_WIDTH = 85;

const SPEED_THRESHOLD = 500;

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern.split("").reduce(function(a, b) {
      return a + ".*" + b;
    });
    return new RegExp(pattern).test(str);
  } else {
    return false;
  }
}

const modalStyles = {
  content: {
    top: 150,
    left: 40,
    right: 40,
    height: window.innerHeight - 300,

    overflow: "hidden",
    // paddingRight:0,
    // paddingBottomt:0,
    // paddingLeft:10,
    // paddingTop:10,
    padding: 0,
    backgroundColor: "white"
  },
  overlay: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: "fixed",
    borderRadius: 0,
    border: 0,
    zIndex: 102,
    backgroundColor: "rgba(200,200,200,0.8)"
  }
};

class ModalPersonEdit extends Component {
  state = { newPersonName: "" };
  render() {
    if (this.state.newPersonName.length > 0) {
      var filteredPeopleList = this.props.people.filter(el =>
        fuzzy_match(
          el.text.toLowerCase(),
          this.state.newPersonName.toLowerCase()
        )
      );
    } else {
      var filteredPeopleList = this.props.people;
    }

    const allFaces = _.concat(
      this.props.inferredFacesList,
      this.props.labeledFacesList
    );

    var selectedImageSrcs = this.props.selectedFaces.map(faceID => {
      return allFaces.filter(face => face.id === faceID)[0].image;
    });
    return (
      <Modal
        ariaHideApp={false}
        onAfterOpen={() => {
          this.props.dispatch(fetchPeople());
        }}
        isOpen={this.props.isOpen}
        onRequestClose={() => {
          this.props.onRequestClose();
          this.setState({ newPersonName: "" });
        }}
        style={modalStyles}
      >
        <div style={{ height: 50, width: "100%", padding: 7 }}>
          <Header>
            Label faces
            <Header.Subheader>
              Label selected {this.props.selectedFaces.length} face(s) as...
            </Header.Subheader>
          </Header>
        </div>
        <Divider fitted />
        <div
          style={{ height: 100, padding: 5, height: 50, overflowY: "hidden" }}
        >
          <Image.Group>
            {selectedImageSrcs.map(image => (
              <SecuredImageJWT key={'selected_image'+image} height={40} width={40} src={image} />
            ))}
          </Image.Group>
        </div>
        <Divider fitted />
        <div
          style={{
            paddingLeft: 10,
            paddingTop: 10,
            overflowY: "scroll",
            height: window.innerHeight - 300 - 100,
            width: "100%"
          }}
        >
          <div style={{ paddingRight: 5 }}>
            <Header as="h4">New person</Header>
            <Popup
              inverted
              content={
                'Album "' +
                this.state.newPersonName.trim() +
                '" already exists.'
              }
              position="bottom center"
              open={this.props.people
                .map(el => el.text.toLowerCase().trim())
                .includes(this.state.newPersonName.toLowerCase().trim())}
              trigger={
                <Input
                  fluid
                  error={this.props.people
                    .map(el => el.text.toLowerCase().trim())
                    .includes(this.state.newPersonName.toLowerCase().trim())}
                  onChange={(e, v) => {
                    this.setState({ newPersonName: v.value });
                  }}
                  placeholder="Person name"
                  action
                >
                  <input />
                  <Button
                    positive
                    onClick={() => {
                      this.props.dispatch(
                        setFacesPersonLabel(
                          this.props.selectedFaces,
                          this.state.newPersonName
                        )
                      );
                      this.props.onRequestClose();
                      this.setState({ newPersonName: "" });
                    }}
                    disabled={this.props.people
                      .map(el => el.text.toLowerCase().trim())
                      .includes(this.state.newPersonName.toLowerCase().trim())}
                    type="submit"
                  >
                    Add Person
                  </Button>
                </Input>
              }
            />
          </div>
          <Divider />
          {filteredPeopleList.length > 0 &&
            filteredPeopleList.map(item => {
              return (
                <div
                  key={'modal_person_face_label_'+item.text}
                  style={{
                    height: 70,
                    justifyContent: "center",
                    alignItems: "center"
                  }}
                >
                  <Header
                    as="h4"
                    onClick={() => {
                      this.props.dispatch(
                        setFacesPersonLabel(this.props.selectedFaces, item.text)
                      );
                      this.props.onRequestClose();
                      // console.log('trying to add photos: ',this.props.selectedFaces)
                      // console.log('to user album id: ',item.id)
                    }}
                  >
                    <SecuredImageJWT
                      circular
                      height={60}
                      width={60}
                      src={serverAddress + item.face_url}
                    />
                    <Header.Content>
                      {item.text}
                      <Header.Subheader>
                        {item.face_count} Photo(s)
                      </Header.Subheader>
                    </Header.Content>
                  </Header>
                </div>
              );
            })}
        </div>
      </Modal>
    );
  }
}

export class FaceDashboard extends Component {
  state = {
    activeItem: "labeled",
    entrySquareSize: 200,
    numEntrySquaresPerRow: 10,
    selectMode: false,
    selectedFaces: [],
    modalPersonEditOpen: false,
    topRowPersonName: null
  };

  handleItemClick = (e, { name }) => this.setState({ activeItem: name });

  scrollSpeedHandler = new ScrollSpeed();

  handleScroll = ({ scrollTop }) => {
    // scrollSpeed represents the number of pixels scrolled since the last scroll event was fired
    const scrollSpeed = Math.abs(
      this.scrollSpeedHandler.getScrollSpeed(scrollTop)
    );

    if (scrollSpeed >= SPEED_THRESHOLD) {
      this.setState({
        isScrollingFast: true,
        scrollTop: scrollTop
      });
    }

    // Since this method is debounced, it will only fire once scrolling has stopped for the duration of SCROLL_DEBOUNCE_DURATION
    this.handleScrollEnd();
  };

  handleScrollEnd = debounce(() => {
    const { isScrollingFast } = this.state;

    if (isScrollingFast) {
      this.setState({
        isScrollingFast: false
      });
    }
  }, SCROLL_DEBOUNCE_DURATION);

  componentDidMount() {
    this.props.dispatch(fetchInferredFacesList());
    this.props.dispatch(fetchLabeledFacesList());
    this.handleResize();
    window.addEventListener("resize", this.handleResize.bind(this));
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    var t0 = performance.now();

    var inferredGroupedByPerson = _.groupBy(
      nextProps.inferredFacesList,
      el => el.person_name
    );
    var inferredGroupedByPersonList = _
      .sortBy(_.toPairsIn(inferredGroupedByPerson), el => el[0])
      .map(el => {
        return { person_name: el[0], faces: el[1] };
      });

    var labeledGroupedByPerson = _.groupBy(
      nextProps.labeledFacesList,
      el => el.person_name
    );
    var labeledGroupedByPersonList = _
      .sortBy(_.toPairsIn(labeledGroupedByPerson), el => el[0])
      .map(el => {
        return { person_name: el[0], faces: el[1] };
      });
    var t1 = performance.now();

    var idx2hash = [];

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
      labeledGroupedByPersonList
    };
    return nextState;
  }

  handleResize() {
    if (this.props.showSidebar) {
      var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10;
    } else {
      var columnWidth = window.innerWidth - 5 - 5 - 10;
    }

    const {
      entrySquareSize,
      numEntrySquaresPerRow
    } = calculateFaceGridCellSize(columnWidth);

    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow
    });

    if (this.state.inferredGroupedByPersonList) {
      const inferredCellContents = calculateFaceGridCells(
        this.state.inferredGroupedByPersonList,
        numEntrySquaresPerRow
      ).cellContents;
      this.setState({
        inferredCellContents
      });
    }
    if (this.state.labeledGroupedByPersonList) {
      const labeledCellContents = calculateFaceGridCells(
        this.state.labeledGroupedByPersonList,
        numEntrySquaresPerRow
      ).cellContents;
      this.setState({
        labeledCellContents
      });
    }
  }

  onFaceSelect(faceID) {
    var selectedFaces = this.state.selectedFaces;
    if (selectedFaces.includes(faceID)) {
      selectedFaces = selectedFaces.filter(item => item !== faceID);
    } else {
      selectedFaces.push(faceID);
    }
    this.setState({ selectedFaces: selectedFaces });
    if (selectedFaces.length == 0) {
      this.setState({ selectMode: false });
    }
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    if (this.state.activeItem === "labeled") {
      var cell = this.state.labeledCellContents[rowIndex][columnIndex];
    } else {
      var cell = this.state.inferredCellContents[rowIndex][columnIndex];
    }

    if (cell) {
      if (!cell.image) {
        return (
          <div
            key={key}
            style={{
              ...style,
              paddingTop: this.state.entrySquareSize / 2.0 - 35,
              width: this.state.width,
              height: this.state.entrySquareSize,
              justifyContent: "center",
              alignItems: "center"
            }}
          >
            <Header size="huge">
              {cell.person_name}
              <Header.Subheader>{cell.faces.length} Faces</Header.Subheader>
            </Header>
            <Divider />
          </div>
        );
      } else {
        const labelProbability = cell.person_label_probability;
        const labelProbabilityColor =
          labelProbability > 0.9
            ? "green"
            : labelProbability > 0.8
              ? "yellow"
              : labelProbability > 0.7
                ? "orange"
                : "red";

        var labelProbabilityIcon = (
          <div style={{ right: 6, bottom: 6, position: "absolute" }}>
            <Popup
              trigger={
                <Icon
                  circular
                  style={{ backgroundColor: "white" }}
                  color={labelProbabilityColor}
                  name="circle"
                />
              }
              on="focus"
              flowing
              inverted
              hideOnScroll
              position="bottom center"
              content={`Confidence: ${(labelProbability * 100).toFixed(1)}%`}
            />
          </div>
        );
        var showPhotoIcon = (
          <div style={{ left: 6, bottom: 6, position: "absolute" }}>
            <Popup
              trigger={
                <Icon
                  circular
                  style={{ backgroundColor: "white" }}
                  color="black"
                  name="image"
                />
              }
              on="focus"
              flowing
              hideOnScroll
              inverted
              position="bottom center"
              content={
                <SecuredImageJWT
                  size="large"
                  src={
                    serverAddress +
                    "/media/thumbnails_big/" +
                    cell.photo +
                    ".jpg"
                  }
                />
              }
            />
          </div>
        );

        if (this.state.isScrollingFast) {
          return (
            <div key={key} style={{ ...style, padding: 5 }}>
              <SecuredImageJWT
                rounded
                src={"/thumbnail_placeholder.png"}
                height={this.state.entrySquareSize - 10}
                width={this.state.entrySquareSize - 10}
              />
            </div>
          );
        } else {
          // TODO: janky shit going on in the next line!
          var faceImageSrc = serverAddress+'/media/faces/'+_.reverse(cell.image.split('/'))[0]
          if (this.state.selectMode) {
            const isSelected = this.state.selectedFaces.includes(cell.id);
            return (
              <div key={key} style={{ ...style, padding: 5 }}>
                <div
                  style={{
                    padding: 10,
                    backgroundColor: isSelected ? "#AED6F1" : "#eeeeee"
                  }}
                >
                  <SecuredImageJWT
                    rounded
                    onClick={() => {
                      this.onFaceSelect(cell.id);
                    }}
                    src={faceImageSrc}
                    height={this.state.entrySquareSize - 30}
                    width={this.state.entrySquareSize - 30}
                  />
                  {this.state.activeItem === "inferred" && labelProbabilityIcon}
                  {showPhotoIcon}
                </div>
              </div>
            );
          } else {
            return (
              <div key={key} style={{ ...style, padding: 5 }}>
                <SecuredImageJWT
                  rounded
                  onClick={() => {
                    this.setState({ selectMode: true });
                    this.onFaceSelect(cell.id);
                  }}
                  src={faceImageSrc}
                  height={this.state.entrySquareSize - 10}
                  width={this.state.entrySquareSize - 10}
                />
                {this.state.activeItem === "inferred" && labelProbabilityIcon}
                {showPhotoIcon}
              </div>
            );
          }
        }
      }
    } else {
      return <div key={key} style={style} />;
    }
  };

  render() {
    const { activeItem } = this.state;
    return (
      <div>
        <div style={{ marginLeft: -5, height: 40 }}>
          <Menu pointing secondary>
            <Menu.Item
              name="labeled"
              active={activeItem === "labeled"}
              onClick={this.handleItemClick}
            >
              {"Labeled "}{" "}
              <Loader
                size="mini"
                inline
                active={this.props.fetchingLabeledFacesList}
              />
            </Menu.Item>
            <Menu.Item
              name="inferred"
              active={activeItem === "inferred"}
              onClick={this.handleItemClick}
            >
              {"Inferred "}{" "}
              <Loader
                size="mini"
                inline
                active={this.props.fetchingInferredFacesList}
              />
            </Menu.Item>
          </Menu>
        </div>
        <div
          style={{
            right: 0,
            top: topMenuHeight,
            position: "fixed",
            padding: 5
          }}
        >
          <Label basic>{this.state.topRowPersonName}</Label>
        </div>

        <div
          style={{
            marginLeft: -5,
            paddingLeft: 5,
            paddingRight: 5,
            height: 40,
            paddingTop: 4,
            backgroundColor: this.state.selectMode ? "#AED6F1" : "#eeeeee"
          }}
        >
          <Checkbox
            label={`${this.state.selectedFaces.length} selected`}
            style={{ padding: 5 }}
            toggle
            checked={this.state.selectMode}
            onClick={() => {
              this.setState({ selectMode: !this.state.selectMode });
            }}
          />

          <Button.Group compact floated="right">
            <Popup
              inverted
              trigger={
                <Button
                  color="green"
                  disabled={this.state.selectedFaces.length === 0}
                  onClick={() => {
                    if (this.state.selectedFaces.length > 0) {
                      this.setState({ modalPersonEditOpen: true });
                    }
                  }}
                  icon="plus"
                />
              }
              content="Add to an existing album or create a new album"
            />
            <Popup
              inverted
              trigger={
                <Button
                  color="red"
                  disabled={this.state.selectedFaces.length === 0}
                  onClick={() => {
                    this.props.dispatch(deleteFaces(this.state.selectedFaces));
                    this.setState({ selectedFaces: [] });
                  }}
                  icon="trash"
                />
              }
              content="delete faces"
            />

            <Popup
              inverted
              trigger={
                <Button
                  disabled={!this.props.workerAvailability}
                  loading={
                    this.props.workerRunningJob &&
                    this.props.workerRunningJob.job_type_str == "Train Faces"
                  }
                  color="blue"
                  onClick={() => {
                    this.props.dispatch(trainFaces());
                  }}
                  icon="lightning"
                />
              }
              content="Train a classifier and automatically label faces"
            />
          </Button.Group>
        </div>

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
                      topRowPersonName: this.state.labeledCellContents[
                        rowStartIndex
                      ][0].person_name
                    });
                  } else {
                    this.setState({
                      topRowPersonName: this.state.inferredCellContents[
                        rowStartIndex
                      ][0].person_name
                    });
                  }
                  // console.log(this.state.labeledCellContents[rowStartIndex][0].person_name)
                }}
                cellRenderer={this.cellRenderer}
                columnWidth={this.state.entrySquareSize}
                columnCount={this.state.numEntrySquaresPerRow}
                height={this.state.height - topMenuHeight - 40 - 40}
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
              selectedFaces: []
            });
          }}
          selectedFaces={this.state.selectedFaces}
        />
      </div>
    );
  }
}

FaceDashboard = connect(store => {
  return {
    workerAvailability: store.util.workerAvailability,
    workerRunningJob: store.util.workerRunningJob,

    showSidebar: store.ui.showSidebar,

    facesList: store.faces.facesList,
    inferredFacesList: store.faces.inferredFacesList,
    labeledFacesList: store.faces.labeledFacesList,

    people: store.people.people,

    facesVis: store.faces.facesVis,
    training: store.faces.training,
    trained: store.faces.trained,
    fetchingLabeledFacesList: store.faces.fetchingLabeledFacesList,
    fetchedLabeledFacesList: store.faces.fetchedLabeledFacesList,
    fetchingInferredFacesList: store.faces.fetchingInferredFacesList,
    fetchedInferredFacesList: store.faces.fetchedInferredFacesList
  };
})(FaceDashboard);

ModalPersonEdit = connect(store => {
  return {
    people: store.people.people,
    fetchingPeople: store.people.fetchingPeople,
    fetchedPeople: store.people.fetchedPeople,

    inferredFacesList: store.faces.inferredFacesList,
    labeledFacesList: store.faces.labeledFacesList,

    fetchingLabeledFacesList: store.faces.fetchingLabeledFacesList,
    fetchedLabeledFacesList: store.faces.fetchedLabeledFacesList,
    fetchingInferredFacesList: store.faces.fetchingInferredFacesList,
    fetchedInferredFacesList: store.faces.fetchedInferredFacesList
  };
})(ModalPersonEdit);

/*
	            <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
	              {({width}) => (
	                <Grid
	                  style={{outline:'none'}}
	                  disableHeader={false}
	                  cellRenderer={this.cellRenderer}
	                  columnWidth={this.state.entrySquareSize}
	                  columnCount={this.state.numEntrySquaresPerRow}
	                  height={this.state.height - topMenuHeight - 60}
	                  rowHeight={this.state.entrySquareSize+60}
	                  rowCount={Math.ceil(this.props.albumsUserList.length/this.state.numEntrySquaresPerRow.toFixed(1))}
	                  width={width}
	                />
	              )}
	            </AutoSizer>  

*/
