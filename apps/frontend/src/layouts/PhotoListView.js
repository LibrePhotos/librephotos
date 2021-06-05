import React, { Component } from "react";
import { Grid, AutoSizer } from "react-virtualized";
import "react-virtualized/styles.css"; // only needs to be imported once
import { connect } from "react-redux";
import { ModalAlbumEdit } from "../components/album/ModalAlbumEdit";
import {
  fetchPhotoDetail,
  setPhotosFavorite,
  setPhotosHidden,
  setPhotosPublic,
} from "../actions/photosActions";
import { copyToClipboard } from "../util/util";
import { SecuredImageJWT } from "../components/SecuredImage";
import { ModalPhotosShare } from "../components/ModalPhotosShare";
import { ModalAlbumShare } from "../components/ModalAlbumShare";
import {
  Dropdown,
  Header,
  Loader,
  Popup,
  Button,
  Icon,
} from "semantic-ui-react";
import { serverAddress, shareAddress } from "../api_client/apiClient";
import { LightBox } from "../components/lightbox/LightBox";
import debounce from "lodash/debounce";
import _ from "lodash";
import * as moment from "moment";
import getToolbar from "../components/photolist/Toolbar";
import { calculateGridCells, calculateGridCellSize } from "../util/gridUtils";
import {
  ScrollSpeed,
  SPEED_THRESHOLD,
  SCROLL_DEBOUNCE_DURATION,
} from "../util/scrollUtils";

var TOP_MENU_HEIGHT = 45; // don't change this
var SIDEBAR_WIDTH = 85;
var TIMELINE_SCROLL_WIDTH = 0;
var DAY_HEADER_HEIGHT = 35;

export class PhotoListView extends Component {
  constructor(props) {
    super(props);
    this.cellRenderer = this.cellRenderer.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.onPhotoClick = this.onPhotoClick.bind(this);
    this.getPhotoDetails = this.getPhotoDetails.bind(this);
    this.listRef = React.createRef();
    this.state = {
      cellContents: [[]],
      imagesGroupedByDate: [],
      hash2row: {},
      idx2hash: [],
      photos: {},
      lightboxImageIndex: 1,
      lightboxShow: false,
      lightboxSidebarShow: false,
      scrollToIndex: undefined,
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: 200,
      numEntrySquaresPerRow: 10,
      currTopRenderedRowIdx: 0,
      scrollTop: 0,
      selectMode: false,
      selectedImageHashes: [],
      modalAddToAlbumOpen: false,
      modalSharePhotosOpen: false,
      modalAlbumShareOpen: false,
    };
  }

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
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
  }
  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize);
    this.scrollSpeedHandler.clearTimeout();
  }

  handleResize() {
    var columnWidth = window.innerWidth - 5 - 5 - 10;
    if (this.props.showSidebar) {
      columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10;
    }

    const { entrySquareSize, numEntrySquaresPerRow } = calculateGridCellSize(
      columnWidth
    );
    var { cellContents, hash2row } = calculateGridCells(
      this.props.photosGroupedByDate,
      numEntrySquaresPerRow
    );

    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow,
      cellContents: cellContents,
      hash2row: hash2row,
    });
    if (this.listRef.current) {
      this.listRef.current.recomputeGridSize();
    }
  }

  onPhotoClick(hash) {
    this.setState({
      lightboxImageIndex: this.props.idx2hash.indexOf(hash),
      lightboxShow: true,
    });
  }

  onPhotoSelect(hash) {
    var selectedImageHashes = this.state.selectedImageHashes;
    if (selectedImageHashes.includes(hash)) {
      selectedImageHashes = selectedImageHashes.filter((item) => item !== hash);
    } else {
      selectedImageHashes.push(hash);
    }
    this.setState({ selectedImageHashes: selectedImageHashes });
    if (selectedImageHashes.length === 0) {
      this.setState({ selectMode: false });
    }
  }

  onGroupSelect(hashes) {
    var selectedImageHashes;
    if (
      _.intersection(hashes, this.state.selectedImageHashes).length ===
      hashes.length
    ) {
      // for deselect
      selectedImageHashes = _.difference(
        this.state.selectedImageHashes,
        hashes
      );
    } else {
      selectedImageHashes = _.union(this.state.selectedImageHashes, hashes);
    }
    this.setState({ selectedImageHashes: selectedImageHashes });
    if (selectedImageHashes.length === 0) {
      this.setState({ selectMode: false });
    }
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    if (this.state.cellContents[rowIndex][columnIndex]) {
      // non-empty cell
      const cell = this.state.cellContents[rowIndex][columnIndex];
      if (cell.date) {
        // header cell has 'date' attribute
        if (this.state.selectMode) {
          return (
            <div
              key={key}
              style={{
                ...style,
                width: this.state.width,
                height: DAY_HEADER_HEIGHT,
                paddingTop: 5,
              }}
            >
              <div
                style={{ backgroundColor: "white", display: "inline-block" }}
              >
                <b>
                  {cell.date === "No Timestamp"
                    ? ""
                    : this.props.dayHeaderPrefix
                    ? this.props.dayHeaderPrefix +
                      moment(cell.date).format("MMM Do YYYY, dddd")
                    : moment(cell.date).format("MMM Do YYYY, dddd")}
                </b>
                <span style={{ color: "grey" }}>
                  {cell.location ? "     " : ""}
                  {cell.location ? <Icon name="map" /> : ""}
                  {cell.location ? cell.location.places.join(", ") : ""}
                </span>
              </div>
              <div
                style={{ float: "left", top: 3, left: 0, position: "relative" }}
              >
                <Button
                  circular
                  color={
                    _.intersection(
                      cell.photos.map((el) => el.image_hash),
                      this.state.selectedImageHashes
                    ).length === cell.photos.length
                      ? "blue"
                      : "grey"
                  }
                  onClick={() => {
                    const hashes = cell.photos.map((p) => p.image_hash);
                    this.onGroupSelect(hashes);
                  }}
                  size="mini"
                  icon="checkmark"
                />
              </div>
            </div>
          );
        } else {
          return (
            <div
              key={key}
              style={{
                ...style,
                width: this.state.width,
                height: DAY_HEADER_HEIGHT,
                paddingTop: 5,
              }}
            >
              <b>
                {cell.date === "No Timestamp"
                  ? ""
                  : this.props.dayHeaderPrefix
                  ? this.props.dayHeaderPrefix +
                    moment(cell.date).format("MMM Do YYYY, dddd")
                  : moment(cell.date).format("MMM Do YYYY, dddd")}
              </b>
              {console.log(cell)}
              <a href={"place/" + (cell.location ? cell.location.places[0].key : "")}>
              <span style={{ color: "grey" }}>
                    {cell.location ? "     " : ""}
                    {cell.location ? <Icon name="map" color="lightGrey" /> : ""}
                    {cell.location ? cell.location.places.join(", ") : ""}
              </span>
              </a>
            </div>
          );
        }
      } else {
        // photo cell doesn't have 'date' attribute

        if (!this.state.isScrollingFast) {
          // photo cell not scrolling fast
          var videoIcon;
          if (
            this.props.photoDetails[cell.image_hash]
              ? this.props.photoDetails[cell.image_hash].video
              : cell.video
          ) {
            videoIcon = (
              <div
                style={{
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  position: "absolute",
                }}
              >
                <Icon
                  circular
                  style={{ backgroundColor: "rgba(255,255,255,0.5)" }}
                  onClick={() => {
                    this.onPhotoClick(cell.image_hash);
                  }}
                  color="black"
                  name="play"
                />
              </div>
            );
          }
          var favIcon;
          if (
            this.props.photoDetails[cell.image_hash]
              ? this.props.photoDetails[cell.image_hash].favorited
              : cell.favorited
          ) {
            favIcon = (
              <div style={{ right: 6, bottom: 6, position: "absolute" }}>
                <Icon
                  circular
                  onClick={() => {
                    this.props.dispatch(
                      setPhotosFavorite([cell.image_hash], false)
                    );
                  }}
                  style={{ backgroundColor: "white" }}
                  color="yellow"
                  name="star"
                />
              </div>
            );
          } else {
            favIcon = (
              <div
                className="gridCellActions"
                style={{ right: 6, bottom: 6, position: "absolute" }}
              >
                <Popup
                  inverted
                  flowing
                  size="mini"
                  content="Add photo to favorites"
                  trigger={
                    <Icon
                      circular
                      onClick={() => {
                        this.props.dispatch(
                          setPhotosFavorite([cell.image_hash], true)
                        );
                      }}
                      style={{ backgroundColor: "white" }}
                      color="grey"
                      name="star"
                    />
                  }
                />
              </div>
            );
          }
          var hiddenIcon;
          if (
            this.props.photoDetails[cell.image_hash]
              ? this.props.photoDetails[cell.image_hash].hidden
              : cell.hidden
          ) {
            hiddenIcon = (
              <div style={{ left: 6, bottom: 6, position: "absolute" }}>
                <Icon
                  circular
                  onClick={() => {
                    this.props.dispatch(
                      setPhotosHidden([cell.image_hash], false)
                    );
                  }}
                  style={{ backgroundColor: "white" }}
                  color="red"
                  name="hide"
                />
              </div>
            );
          } else {
            hiddenIcon = (
              <div
                className="gridCellActions"
                style={{ left: 6, bottom: 6, position: "absolute" }}
              >
                <Popup
                  inverted
                  flowing
                  size="mini"
                  content="Hide photo"
                  trigger={
                    <Icon
                      circular
                      onClick={() => {cell.location
                        this.props.dispatch(
                          setPhotosHidden([cell.image_hash], true)
                        );
                      }}
                      style={{ backgroundColor: "white" }}
                      color="grey"
                      name="hide"
                    />
                  }
                />
              </div>
            );
          }
          var publicIcon;
          if (
            this.props.photoDetails[cell.image_hash]
              ? this.props.photoDetails[cell.image_hash].public
              : cell.public
          ) {
            publicIcon = (
              <div style={{ right: 6, top: 6, position: "absolute" }}>
                <Icon
                  circular
                  onClick={() => {
                    this.props.dispatch(
                      setPhotosPublic([cell.image_hash], false)
                    );
                  }}
                  style={{ backgroundColor: "white" }}
                  color="green"
                  name="globe"
                />
              </div>
            );
          } else {
            publicIcon = (
              <div
                className="gridCellActions"
                style={{ right: 6, top: 6, position: "absolute" }}
              >
                <Popup
                  inverted
                  flowing
                  size="mini"
                  content="Make public and copy link to clipboard"
                  trigger={
                    <Icon
                      circular
                      onClick={() => {
                        this.props.dispatch(
                          setPhotosPublic([cell.image_hash], true)
                        );
                        copyToClipboard(
                          shareAddress +
                            "/media/photos/" +
                            cell.image_hash +
                            ".jpg"
                        );
                      }}
                      style={{ backgroundColor: "white" }}
                      name="globe"
                      color="grey"
                    />
                  }
                />
              </div>
            );
          }

          if (this.state.selectMode) {
            // select mode
            return (
              <div
                className="gridCell"
                key={key}
                style={{
                  ...style,
                  padding: 15,
                  backgroundColor: this.state.selectedImageHashes.includes(
                    cell.image_hash
                  )
                    ? "#AED6F1"
                    : "#eeeeee",
                  margin: 1,
                  width: style.width - 2,
                  height: style.height - 2,
                }}
              >
                {(this.props.photoDetails[cell.image_hash]
                  ? this.props.photoDetails[cell.image_hash].hidden
                  : cell.hidden) && !this.props.showHidden ? (
                  <div
                    style={{
                      height: this.state.entrySquareSize - 32,
                      width: this.state.entrySquareSize - 32,
                      padding: 0,
                      margin: 0,
                      backgroundColor: "#dddddd",
                    }}
                  />
                ) : (
                  <SecuredImageJWT
                    isPublic={this.props.isPublic}
                    key={"daygroup_image_" + cell.image_hash}
                    style={{ display: "inline-block", padding: 1, margin: 0 }}
                    height={this.state.entrySquareSize - 30}
                    width={this.state.entrySquareSize - 30}
                    src={
                      serverAddress +
                      "/media/square_thumbnails/" +
                      cell.image_hash +
                      ".jpg"
                    }
                  />
                )}

                <div style={{ left: 5, top: 5, position: "absolute" }}>
                  <Icon
                    style={{ backgroundColor: "white" }}
                    circular
                    onClick={() => {
                      this.onPhotoSelect(cell.image_hash);
                    }}
                    name={
                      this.state.selectedImageHashes.includes(cell.image_hash)
                        ? "checkmark"
                        : ""
                    }
                    color={
                      this.state.selectedImageHashes.includes(cell.image_hash)
                        ? "blue"
                        : "grey"
                    }
                  />
                </div>
                {videoIcon}
                {!this.props.isPublic && hiddenIcon}
                {!this.props.isPublic && favIcon}
                {!this.props.isPublic && publicIcon}
              </div>
            );
          } else {
            // normal mode

            return (
              <div className="gridCell" key={key} style={style}>
                {(this.props.photoDetails[cell.image_hash]
                  ? this.props.photoDetails[cell.image_hash].hidden
                  : cell.hidden) && !this.props.showHidden ? (
                  <div
                    style={{
                      height: this.state.entrySquareSize - 2,
                      width: this.state.entrySquareSize - 2,
                      padding: 0,
                      backgroundColor: "#dddddd",
                    }}
                  />
                ) : (
                  <SecuredImageJWT
                    isPublic={this.props.isPublic}
                    key={"daygroup_image_" + cell.image_hash}
                    style={{ display: "inline-block", padding: 1, margin: 0 }}
                    onClick={() => {
                      this.onPhotoClick(cell.image_hash);
                    }}
                    height={this.state.entrySquareSize}
                    width={this.state.entrySquareSize}
                    src={
                      serverAddress +
                      "/media/square_thumbnails/" +
                      cell.image_hash +
                      ".jpg"
                    }
                  />
                )}

                <div
                  className="gridCellActions"
                  style={{ left: 6, top: 6, position: "absolute" }}
                >
                  {!this.props.isPublic && (
                    <Icon
                      style={{ backgroundColor: "white" }}
                      circular
                      onClick={() => {
                        if (!this.props.isPublic) {
                          this.onPhotoSelect(cell.image_hash);
                          this.setState({ selectMode: true });
                        }
                      }}
                      name="checkmark"
                      color={
                        this.state.selectedImageHashes.includes(cell.image_hash)
                          ? "blue"
                          : "grey"
                      }
                    />
                  )}
                </div>
                {videoIcon}
                {!this.props.isPublic && hiddenIcon}
                {!this.props.isPublic && favIcon}
                {!this.props.isPublic && publicIcon}
              </div>
            );
          }
        } else {
          return (
            <div
              key={key}
              style={{
                ...style,
                width: this.state.entrySquareSize - 2,
                height: this.state.entrySquareSize - 2,
                backgroundColor: this.state.selectedImageHashes.includes(
                  cell.image_hash
                )
                  ? "#AED6F1"
                  : "#eeeeee",
              }}
            />
          );
        }
      }
    } else {
      // empty cell
      return <div key={key} style={style} />;
    }
  };

  getPhotoDetails(image_hash) {
    this.props.dispatch(fetchPhotoDetail(image_hash));
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    if (prevProps.showSidebar !== this.props.showSidebar) {
      this.handleResize();
    }
    if (prevProps.gridType !== this.props.gridType) {
      this.handleResize();
    }
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    const imagesGroupedByDate = nextProps.photosGroupedByDate;
    const { cellContents, hash2row } = calculateGridCells(
      imagesGroupedByDate,
      prevState.numEntrySquaresPerRow
    );
    const nextState = {
      ...prevState,
      cellContents,
      hash2row,
      imagesGroupedByDate,
    };
    return nextState;
  }

  render() {
    if (
      this.props.loading ||
      this.props.idx2hash.length < 1 ||
      this.props.photosGroupedByDate.length < 1
    ) {
      return (
        <div>
          <div style={{ height: 60, paddingTop: 10 }}>
            <Header as="h4">
              <Header.Content>
                Loading...
                <Loader inline active={this.props.loading} size="mini" />
              </Header.Content>
            </Header>
          </div>

          {this.props.idx2hash.length < 1 ||
          this.props.photosGroupedByDate.length < 1 ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: this.state.height - TOP_MENU_HEIGHT - 60,
              }}
            >
              <Header>{this.props.noResultsMessage}</Header>
            </div>
          ) : (
            <AutoSizer
              disableHeight
              style={{ outline: "none", padding: 0, margin: 0 }}
            >
              {({ width }) => (
                <Grid
                  overscanRowCount={0}
                  style={{ outline: "none" }}
                  cellRenderer={({ columnIndex, key, rowIndex, style }) => {
                    if (rowIndex % 3 === 0 && columnIndex === 0) {
                      return (
                        <div
                          key={key}
                          style={{
                            ...style,
                            width: this.state.width,
                            height: DAY_HEADER_HEIGHT,
                            paddingTop: 20,
                          }}
                        >
                          <div
                            style={{
                              backgroundColor: "#dddddd",
                              height: 40,
                              width: 260,
                            }}
                          />
                        </div>
                      );
                    } else if (rowIndex % 3 === 0 && columnIndex > 0) {
                      return <div key={key} style={style} />;
                    } else {
                      return (
                        <div style={{ ...style }} key={key}>
                          <SecuredImageJWT
                            isPublic={this.props.isPublic}
                            style={{ padding: 1, margin: 0 }}
                            height={this.state.entrySquareSize}
                            width={this.state.entrySquareSize}
                            src="/thumbnail_placeholder.png"
                          />
                        </div>
                      );
                    }
                  }}
                  columnWidth={width / this.state.numEntrySquaresPerRow}
                  columnCount={this.state.numEntrySquaresPerRow}
                  height={this.state.height - TOP_MENU_HEIGHT - 60}
                  rowHeight={({ index }) => {
                    if (index % 3) {
                      return (
                        width.toFixed(1) / this.state.numEntrySquaresPerRow
                      );
                    } else {
                      return DAY_HEADER_HEIGHT;
                    }
                  }}
                  rowCount={5000}
                  width={width}
                />
              )}
            </AutoSizer>
          )}
        </div>
      );
    }
    var totalListHeight = this.state.cellContents
      .map((row, index) => {
        if (row[0].date) {
          //header row
          return DAY_HEADER_HEIGHT;
        } else {
          //photo row
          return this.state.entrySquareSize;
        }
      })
      .reduce((a, b) => a + b, 0);

    console.log(this.props);
    var isUserAlbum = false;
    if (this.props.route.location.pathname.startsWith("/useralbum/")) {
      isUserAlbum = true;
    }

    return (
      <div>
        {true && !this.props.isPublic && (
          <div
            style={{
              marginLeft: -5,
              paddingLeft: 5,
              paddingRight: 5,
              height: 40,
              paddingTop: 4,
              backgroundColor: "#f6f6f6",
            }}
          >
            <Button.Group
              compact
              floated="left"
              style={{ paddingLeft: 2, paddingRight: 2 }}
            >
              <Popup
                trigger={
                  <Button
                    icon="checkmark"
                    compact
                    active={this.state.selectMode}
                    color={this.state.selectMode ? "blue" : "null"}
                    onClick={() => {
                      this.setState({ selectMode: !this.state.selectMode });
                      if (this.state.selectMode) {
                        this.setState({ selectedImageHashes: [] });
                      }
                    }}
                    label={{
                      as: "a",
                      basic: true,
                      content: `${this.state.selectedImageHashes.length} selected`,
                    }}
                    labelPosition="right"
                  />
                }
                content="Toggle select mode"
                inverted
              />
            </Button.Group>

            <Button.Group
              compact
              floated="left"
              style={{ paddingLeft: 2, paddingRight: 2 }}
            >
              <Popup
                inverted
                trigger={
                  <Button
                    icon
                    compact
                    positive={
                      this.state.selectedImageHashes.length !==
                      this.props.idx2hash.length
                    }
                    negative={
                      this.state.selectedImageHashes.length ===
                      this.props.idx2hash.length
                    }
                    onClick={() => {
                      if (
                        this.state.selectedImageHashes.length ===
                        this.props.idx2hash.length
                      ) {
                        this.setState({ selectedImageHashes: [] });
                      } else {
                        this.setState({
                          selectMode: true,
                          selectedImageHashes: this.props.idx2hash,
                        });
                      }
                    }}
                  >
                    <Icon
                      name={
                        this.state.selectedImageHashes.length ===
                        this.props.idx2hash.length
                          ? "check circle outline"
                          : "check circle"
                      }
                    />
                  </Button>
                }
                content={
                  this.state.selectedImageHashes.length ===
                  this.props.idx2hash.length
                    ? "Deselect all"
                    : "Select All"
                }
              />
            </Button.Group>
            {getToolbar(this)}
            <Button.Group
              style={{ paddingLeft: 2, paddingRight: 2 }}
              floated="right"
              compact
              color="teal"
            >
              <Dropdown
                disabled={this.state.selectedImageHashes.length === 0}
                pointing="top right"
                icon="plus"
                floating
                button
                compact
                floated="right"
                className="icon"
              >
                <Dropdown.Menu>
                  <Dropdown.Header>
                    Album ({this.state.selectedImageHashes.length} selected)
                  </Dropdown.Header>
                  <Dropdown.Divider />
                  <Dropdown.Item
                    onClick={() => {
                      if (this.state.selectedImageHashes.length > 0) {
                        this.setState({ modalAddToAlbumOpen: true });
                      }
                    }}
                  >
                    <Icon name="bookmark" color="red" />
                    {" Album"}
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </Button.Group>

            {false && isUserAlbum && (
              <Popup
                inverted
                trigger={
                  <Button.Group
                    style={{ paddingLeft: 2, paddingRight: 2 }}
                    floated="right"
                    compact
                    icon
                    onClick={() => {
                      this.setState({ modalAlbumShareOpen: true });
                    }}
                  >
                    <Button icon="share alternate" />
                  </Button.Group>
                }
                content="Share album"
              />
            )}

            <Button.Group
              style={{ paddingLeft: 2, paddingRight: 2 }}
              floated="right"
              compact
            >
              <Popup
                inverted
                trigger={
                  <Button
                    active={this.props.gridType === "dense"}
                    onClick={() => {
                      this.props.dispatch({
                        type: "SET_GRID_TYPE",
                        payload: "dense",
                      });
                    }}
                    icon
                  >
                    <Icon name="grid layout" />
                  </Button>
                }
                content="Small thumbnails"
              />
              <Popup
                inverted
                trigger={
                  <Button
                    active={this.props.gridType === "loose"}
                    onClick={() => {
                      this.props.dispatch({
                        type: "SET_GRID_TYPE",
                        payload: "loose",
                      });
                    }}
                    icon
                  >
                    <Icon name="block layout" />
                  </Button>
                }
                content="Big thumbnails"
              />
            </Button.Group>
          </div>
        )}

        <AutoSizer
          disableHeight
          style={{ outline: "none", padding: 0, margin: 0 }}
        >
          {({ width }) => (
            <Grid
              ref={this.listRef}
              onSectionRendered={({ rowStartIndex }) => {
                const cell = this.state.cellContents[rowStartIndex][0];
                if (cell.date) {
                  var date = cell.date;
                  if (date === "No Timestamp") {
                    this.setState({
                      date: date,
                      fromNow: date,
                    });
                  } else {
                    this.setState({
                      date: moment(date).format("MMMM Do YYYY"),
                      fromNow: moment(date).fromNow(),
                    });
                  }
                }
              }}
              overscanRowCount={5}
              style={{ outline: "none" }}
              cellRenderer={this.cellRenderer}
              onScroll={this.handleScroll}
              columnWidth={this.state.entrySquareSize}
              columnCount={this.state.numEntrySquaresPerRow}
              height={
                this.props.isPublic
                  ? this.state.height - TOP_MENU_HEIGHT - 60
                  : this.state.height - TOP_MENU_HEIGHT - 60 - 40
              }
              estimatedRowSize={
                totalListHeight / this.state.cellContents.length.toFixed(1)
              }
              rowHeight={({ index }) => {
                if (this.state.cellContents[index][0].date) {
                  //header row
                  return DAY_HEADER_HEIGHT;
                } else {
                  //photo row
                  return this.state.entrySquareSize;
                }
              }}
              rowCount={this.state.cellContents.length}
              width={width}
            />
          )}
        </AutoSizer>

        <div
          style={{
            backgroundColor: "white",
            position: "fixed",
            right: 0,
            top: TOP_MENU_HEIGHT,
            height: this.state.height - TOP_MENU_HEIGHT,
            width: TIMELINE_SCROLL_WIDTH,
          }}
        />

        {this.state.lightboxShow && (
          <LightBox
            isPublic={this.props.isPublic}
            showHidden={this.props.showHidden}
            idx2hash={this.props.idx2hash}
            lightboxImageIndex={this.state.lightboxImageIndex}
            onCloseRequest={() => this.setState({ lightboxShow: false })}
            onImageLoad={() => {
              this.getPhotoDetails(
                this.props.idx2hash[this.state.lightboxImageIndex]
              );
            }}
            onMovePrevRequest={() => {
              var prevIndex =
                (this.state.lightboxImageIndex +
                  this.props.idx2hash.length -
                  1) %
                this.props.idx2hash.length;
              this.setState({
                lightboxImageIndex: prevIndex,
              });
              var rowIdx = this.state.hash2row[this.props.idx2hash[prevIndex]];
              this.listRef.current.scrollToCell({
                columnIndex: 0,
                rowIndex: rowIdx,
              });
              this.getPhotoDetails(this.props.idx2hash[prevIndex]);
            }}
            onMoveNextRequest={() => {
              var nextIndex =
                (this.state.lightboxImageIndex +
                  this.props.idx2hash.length +
                  1) %
                this.props.idx2hash.length;
              this.setState({
                lightboxImageIndex: nextIndex,
              });
              var rowIdx = this.state.hash2row[this.props.idx2hash[nextIndex]];
              this.listRef.current.scrollToCell({
                columnIndex: 0,
                rowIndex: rowIdx,
              });
              this.getPhotoDetails(this.props.idx2hash[nextIndex]);
            }}
          />
        )}

        {!this.props.isPublic && (
          <ModalAlbumEdit
            isOpen={this.state.modalAddToAlbumOpen}
            onRequestClose={() => {
              this.setState({
                modalAddToAlbumOpen: false,
              });
            }}
            selectedImageHashes={this.state.selectedImageHashes}
          />
        )}
        {!this.props.isPublic && (
          <ModalPhotosShare
            isOpen={this.state.modalSharePhotosOpen}
            onRequestClose={() => {
              this.setState({
                modalSharePhotosOpen: false,
              });
            }}
            selectedImageHashes={this.state.selectedImageHashes}
          />
        )}
        {!this.props.isPublic && isUserAlbum && (
          <ModalAlbumShare
            isOpen={this.state.modalAlbumShareOpen}
            onRequestClose={() => {
              this.setState({
                modalAlbumShareOpen: false,
              });
            }}
            match={this.props.match}
            selectedImageHashes={this.state.selectedImageHashes}
          />
        )}
      </div>
    );
  }
}

PhotoListView = connect((store) => {
  return {
    showSidebar: store.ui.showSidebar,
    gridType: store.ui.gridType,

    photos: store.photos.photos,
    fetchingPhotos: store.photos.fetchingPhotos,
    fetchedPhotos: store.photos.fetchedPhotos,

    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,

    route: store.routerReducer,
  };
})(PhotoListView);
