import React, { Component } from "react";
import { Grid, AutoSizer } from "react-virtualized";
import "react-virtualized/styles.css"; // only needs to be imported once
import { connect } from "react-redux";
import {
  fetchUserAlbumsList,
  editUserAlbum,
  createNewUserAlbum
} from "../actions/albumsActions";
import {
  fetchPhotoDetail,
  setPhotosFavorite,
  setPhotosHidden,
  setPhotosPublic
} from "../actions/photosActions";
import { copyToClipboard } from "../util/util";
import { SecuredImageJWT } from "../components/SecuredImage";
import { ModalPhotosShare } from "../components/ModalPhotosShare";
import { ModalAlbumShare } from "../components/ModalAlbumShare";
import {
  Dropdown,
  Header,
  Divider,
  Loader,
  Image,
  Input,
  Popup,
  Button,
  Icon
} from "semantic-ui-react";
import { serverAddress, shareAddress } from "../api_client/apiClient";
import { LightBox } from "../components/lightBox";
import { LightBoxV2 } from "../components/LightBoxV2";
import debounce from "lodash/debounce";
import _ from "lodash";
import * as moment from "moment";
import Modal from "react-modal";
import { calculateGridCells, calculateGridCellSize } from "../util/gridUtils";
import {
  ScrollSpeed,
  SPEED_THRESHOLD,
  SCROLL_DEBOUNCE_DURATION
} from "../util/scrollUtils";


var TOP_MENU_HEIGHT = 45; // don't change this
var LEFT_MENU_WIDTH = 85; // don't change this
var SIDEBAR_WIDTH = 85;
var TIMELINE_SCROLL_WIDTH = 0;
var DAY_HEADER_HEIGHT = 70;

if (window.innerWidth < 600) {
  var LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth;
} else {
  var LIGHTBOX_SIDEBAR_WIDTH = 360;
}

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

const customStyles = {
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
      modalAlbumShareOpen: false
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
    // this.props.dispatch(fetchPhotos())
    // if (this.props.photosGroupedByDate.length < 1) {
    //     this.props.dispatch(fetchDateAlbumsPhotoHashList())
    // }
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
  }
  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize);
    this.scrollSpeedHandler.clearTimeout();
  }

  handleResize() {
    if (this.props.showSidebar) {
      var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10;
    } else {
      var columnWidth = window.innerWidth - 5 - 5 - 10;
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
      hash2row: hash2row
    });
    if (this.listRef.current) {
      this.listRef.current.recomputeGridSize();
    }
  }

  onPhotoClick(hash) {
    this.setState({
      lightboxImageIndex: this.props.idx2hash.indexOf(hash),
      lightboxShow: true
    });
  }

  onPhotoSelect(hash) {
    var selectedImageHashes = this.state.selectedImageHashes;
    if (selectedImageHashes.includes(hash)) {
      selectedImageHashes = selectedImageHashes.filter(item => item !== hash);
    } else {
      selectedImageHashes.push(hash);
    }
    this.setState({ selectedImageHashes: selectedImageHashes });
    if (selectedImageHashes.length === 0) {
      this.setState({ selectMode: false });
    }
  }

  onGroupSelect(hashes) {
    if (
      _.intersection(hashes, this.state.selectedImageHashes).length ===
      hashes.length
    ) {
      // for deselect
      var selectedImageHashes = _.difference(
        this.state.selectedImageHashes,
        hashes
      );
    } else {
      var selectedImageHashes = _.union(this.state.selectedImageHashes, hashes);
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
                paddingTop: 20
              }}
            >
              <div
                style={{ backgroundColor: "white", display: "inline-block" }}
              >
                <Header as="h3">
                  <Icon name="calendar outline" />
                  <Header.Content>
                    {cell.date === "No Timestamp"
                      ? "No Timestamp"
                      : this.props.dayHeaderPrefix
                        ? this.props.dayHeaderPrefix + moment(cell.date).format("MMM Do YYYY, dddd")
                        : moment(cell.date).format("MMM Do YYYY, dddd")}
                    <Header.Subheader>
                      <Icon name="photo" />
                      {cell.photos.length} Photos
                    </Header.Subheader>
                  </Header.Content>
                </Header>
              </div>
              <div
                style={{ float: "left", top: 3, left: 0, position: "relative" }}
              >
                <Button
                  circular
                  color={
                    _.intersection(
                      cell.photos.map(el => el.image_hash),
                      this.state.selectedImageHashes
                    ).length === cell.photos.length
                      ? "blue"
                      : "grey"
                  }
                  onClick={() => {
                    const hashes = cell.photos.map(p => p.image_hash);
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
                paddingTop: 20
              }}
            >
              <div style={{ backgroundColor: "white" }}>
                <Header as="h3">
                  <Icon name="calendar outline" />
                  <Header.Content>
                    {cell.date === "No Timestamp"
                      ? "No Timestamp"
                      : this.props.dayHeaderPrefix
                        ? this.props.dayHeaderPrefix + moment(cell.date).format("MMM Do YYYY, dddd")
                        : moment(cell.date).format("MMM Do YYYY, dddd")}
                    {cell.location ? (
                      <Header.Subheader>
                        <Icon name="map" />
                        {cell.location.places.join(", ")}
                      </Header.Subheader>
                    ) : (
                      <Header.Subheader>
                        <Icon name="photo" />
                        {cell.photos.length} Photos
                      </Header.Subheader>
                    )}
                  </Header.Content>
                </Header>
              </div>
            </div>
          );
        }
      } else {
        // photo cell doesn't have 'date' attribute

        if (!this.state.isScrollingFast) {
          // photo cell not scrolling fast
          if (
            this.props.photoDetails[cell.image_hash]
              ? this.props.photoDetails[cell.image_hash].favorited
              : cell.favorited
          ) {
            var favIcon = (
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
            var favIcon = (
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

          if (
            this.props.photoDetails[cell.image_hash]
              ? this.props.photoDetails[cell.image_hash].hidden
              : cell.hidden
          ) {
            var hiddenIcon = (
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
            var hiddenIcon = (
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
                      onClick={() => {
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

          if (
            this.props.photoDetails[cell.image_hash]
              ? this.props.photoDetails[cell.image_hash].public
              : cell.public
          ) {
            var publicIcon = (
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
            var publicIcon = (
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
                        // Location of generated link when shareing from album. 
                        //Origianl was 
                        //serverAddress.replace('//','') +
                        // "/media/reusableline505/" +
                        // cell.image_hash +
                        // ".jpg" DW 12-13-20
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
                  height: style.height - 2
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
                      backgroundColor: "#dddddd"
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
                      backgroundColor: "#dddddd"
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
                  : "#eeeeee"
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
    var t0 = performance.now();
    const imagesGroupedByDate = nextProps.photosGroupedByDate;
    var t1 = performance.now();

    var idx2hash = [];

    const { cellContents, hash2row } = calculateGridCells(
      imagesGroupedByDate,
      prevState.numEntrySquaresPerRow
    );
    const nextState = {
      ...prevState,
      cellContents,
      hash2row,
      imagesGroupedByDate
    };
    return nextState;
  }

  render() {
    const { lightboxImageIndex } = this.state;
    if (
      this.props.loading ||
      this.props.idx2hash.length < 1 ||
      this.props.photosGroupedByDate.length < 1
    ) {
      //if (true) {
      return (
        <div>
          <div style={{ height: 60, paddingTop: 10 }}>
            <Header as="h2">
              <Icon name={this.props.titleIconName} />
              <Header.Content>
                {this.props.title}
                <Loader inline active={this.props.loading} size="mini" />
                {this.props.loading ? (
                  <Header.Subheader>Loading...</Header.Subheader>
                ) : (
                  <Header.Subheader>
                    {this.props.photosGroupedByDate.length} Days,{" "}
                    {this.props.idx2hash.length} Photos
                  </Header.Subheader>
                )}
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
                height: this.state.height - TOP_MENU_HEIGHT - 60
                // width:this.state.width
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
                            paddingTop: 20
                          }}
                        >
                          <div
                            style={{
                              backgroundColor: "#dddddd",
                              height: 40,
                              width: 260
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

    if (this.props.route.location.pathname.startsWith("/useralbum/")) {
      var isUserAlbum = true;
    } else {
      var isUserAlbum = false;
    }

    return (
      <div>
        <div style={{ height: 60, paddingTop: 10 }}>
          <Header as="h2">
            <Icon name={this.props.titleIconName} />
            <Header.Content>
              {this.props.title}{" "}
              <Header.Subheader>
                {this.props.photosGroupedByDate.length} days,{" "}
                {this.props.idx2hash.length} photos
                {this.props.additionalSubHeader}
              </Header.Subheader>
            </Header.Content>
          </Header>
        </div>

        {true &&
          !this.props.isPublic && (
            <div
              style={{
                marginLeft: -5,
                paddingLeft: 5,
                paddingRight: 5,
                height: 40,
                paddingTop: 4,
                backgroundColor: "#f6f6f6"
              }}
            >
              {/* <Checkbox
                fitted
                label={" "}
                style={{ padding: 5 }}
                toggle
                checked={this.state.selectMode}
                onClick={() => {
                  this.setState({ selectMode: !this.state.selectMode });
                  if (this.state.selectMode) {
                    this.setState({ selectedImageHashes: [] });
                  }
                }}
              /> */}

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
                        content: `${
                          this.state.selectedImageHashes.length
                        } selected`
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
                            selectedImageHashes: this.props.idx2hash
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

              <Button.Group
                style={{ paddingLeft: 2, paddingRight: 2 }}
                compact
                floated="right"
                color="orange"
              >
                <Dropdown
                  icon="ellipsis vertical"
                  pointing="top right"
                  floating
                  button
                  compact
                  floated="right"
                  className="icon"
                  color="blue"
                >
                  <Dropdown.Menu>
                    <Dropdown.Header>
                      <Icon name='image'/>Photo Actions ({this.state.selectedImageHashes.length} selected)
                    </Dropdown.Header>

                    <Dropdown.Divider />
                    <Dropdown.Item
                      disabled={this.state.selectedImageHashes.length === 0}
                      onClick={() => {
                        this.props.dispatch(
                          setPhotosFavorite(
                            this.state.selectedImageHashes,
                            true
                          )
                        );
                      }}
                    >
                      <Icon name="star" color="yellow" />
                      {"  Favorite"}
                    </Dropdown.Item>
                    <Dropdown.Item
                      disabled={this.state.selectedImageHashes.length === 0}
                      onClick={() => {
                        this.props.dispatch(
                          setPhotosFavorite(
                            this.state.selectedImageHashes,
                            false
                          )
                        );
                      }}
                    >
                      <Icon name="star outline" color="yellow" />
                      {"  Unfavorite"}
                    </Dropdown.Item>

                    <Dropdown.Divider />
                    <Dropdown.Item
                      disabled={this.state.selectedImageHashes.length === 0}
                      onClick={() => {
                        this.props.dispatch(
                          setPhotosHidden(this.state.selectedImageHashes, true)
                        );
                      }}
                    >
                      <Icon name="hide" color="red" />
                      {"  Hide"}
                    </Dropdown.Item>
                    <Dropdown.Item
                      disabled={this.state.selectedImageHashes.length === 0}
                      onClick={() => {
                        this.props.dispatch(
                          setPhotosHidden(this.state.selectedImageHashes, false)
                        );
                      }}
                    >
                      <Icon name="unhide" color="black" />
                      {"  Unhide"}
                    </Dropdown.Item>

                    <Dropdown.Divider />
                    <Dropdown.Item
                      disabled={this.state.selectedImageHashes.length === 0}
                      onClick={() => {
                        this.props.dispatch(
                          setPhotosPublic(this.state.selectedImageHashes, true)
                        );
                        const linksToCopy = this.state.selectedImageHashes
                          .map(
                            ih => serverAddress + "/media/photos/" + ih + ".jpg"
                          )
                          .join("\n");
                        copyToClipboard(linksToCopy);
                      }}
                    >
                      <Icon name="globe" />
                      {"  Make Public"}
                    </Dropdown.Item>
                    <Dropdown.Item
                      disabled={this.state.selectedImageHashes.length === 0}
                      onClick={() => {
                        this.props.dispatch(
                          setPhotosPublic(this.state.selectedImageHashes, false)
                        );
                      }}
                    >
                      <Icon name="key" />
                      {"  Make Private"}
                    </Dropdown.Item>

                    <Dropdown.Divider />
                    <Popup
                      inverted
                      position='left center'
                      trigger={
                        <Dropdown.Item
                          disabled={this.state.selectedImageHashes.length === 0}
                          onClick={() => {
                            if (this.state.selectedImageHashes.length > 0) {
                              this.setState({ modalSharePhotosOpen: true });
                            }
                          }}
                        >
                          <Icon name="share" />
                          {"  Sharing"}
                        </Dropdown.Item>
                      }
                      content="Open sharing panel for selected photos"
                    />
                    <Dropdown.Divider/>
                    <Dropdown.Header>
                      <Icon name='images'/>Album Actions
                    </Dropdown.Header>
                    <Popup
                      inverted
                      position='left center'
                      trigger={
                        <Dropdown.Item
                          disabled={!this.props.route.location.pathname.startsWith("/useralbum/")}
                          onClick={() => {
                              //todo
                            this.setState({ modalAlbumShareOpen: true });
                          }}
                        >
                          <Icon name="share" />
                          {"  Sharing"}
                        </Dropdown.Item>
                      }
                      content="Open sharing panel for the current album"
                    />




                  </Dropdown.Menu>
                </Dropdown>
              </Button.Group>

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
                          payload: "dense"
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
                          payload: "loose"
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
                  if (date == "No Timestamp") {
                    this.setState({
                      date: date,
                      fromNow: date
                    });
                  } else {
                    this.setState({
                      date: moment(date).format("MMMM Do YYYY"),
                      fromNow: moment(date).fromNow()
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
                // this.state.selectMode
                //   ? this.state.height - TOP_MENU_HEIGHT - 60 - 40
                //   : this.state.height - TOP_MENU_HEIGHT - 60
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

        {this.state.cellContents[this.state.currTopRenderedRowIdx][0] && (
          <div
            style={{
              right: 0,
              top:
                TOP_MENU_HEIGHT +
                10 +
                (0 / totalListHeight) *
                  (this.state.height - TOP_MENU_HEIGHT - 50 - 20),
              position: "fixed",
              float: "left",
              width: 180,
              padding: 0,
              height: 50,
              zIndex: 100
            }}
          >
            <div
              style={{ textAlign: "right", paddingRight: 30 }}
              className="handle"
            >
              <b>
              {
                this.props.dayHeaderPrefix
                  ? this.props.dayHeaderPrefix + this.state.date
                  : this.state.date
              }</b> <br />
            </div>
            <div style={{ textAlign: "right", paddingRight: 30 }}>
              {this.state.fromNow}
            </div>
          </div>
        )}

        <div
          style={{
            backgroundColor: "white",
            position: "fixed",
            right: 0,
            top: TOP_MENU_HEIGHT,
            height: this.state.height - TOP_MENU_HEIGHT,
            width: TIMELINE_SCROLL_WIDTH
          }}
        />

        {this.state.lightboxShow &&
          false && (
            <LightBoxV2
              isOpen={this.state.lightboxShow}
              onCloseRequest={() => {
                this.setState({ lightboxShow: false });
              }}
              idx2hash={this.props.idx2hash}
              lightboxImageIndex={this.state.lightboxImageIndex}
              onImageLoad={() => {
                this.getPhotoDetails(
                  this.props.idx2hash[this.state.lightboxImageIndex]
                );
              }}
            />
          )}

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
                lightboxImageIndex: prevIndex
              });
              var rowIdx = this.state.hash2row[this.props.idx2hash[prevIndex]];
              this.listRef.current.scrollToCell({
                columnIndex: 0,
                rowIndex: rowIdx
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
                lightboxImageIndex: nextIndex
              });
              var rowIdx = this.state.hash2row[this.props.idx2hash[nextIndex]];
              this.listRef.current.scrollToCell({
                columnIndex: 0,
                rowIndex: rowIdx
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
                modalAddToAlbumOpen: false
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
                modalSharePhotosOpen: false
              });
            }}
            selectedImageHashes={this.state.selectedImageHashes}
          />
        )}
        {!this.props.isPublic &&
          isUserAlbum && (
            <ModalAlbumShare
              isOpen={this.state.modalAlbumShareOpen}
              onRequestClose={() => {
                this.setState({
                  modalAlbumShareOpen: false
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

class ModalAlbumEdit extends Component {
  state = { newAlbumTitle: "" };
  render() {
    if (this.state.newAlbumTitle.length > 0) {
      var filteredUserAlbumList = this.props.albumsUserList.filter(el =>
        fuzzy_match(
          el.title.toLowerCase(),
          this.state.newAlbumTitle.toLowerCase()
        )
      );
    } else {
      var filteredUserAlbumList = this.props.albumsUserList;
    }
    return (
      <Modal
        ariaHideApp={false}
        onAfterOpen={() => {
          this.props.dispatch(fetchUserAlbumsList());
        }}
        isOpen={this.props.isOpen}
        onRequestClose={() => {
          this.props.onRequestClose();
          this.setState({ newAlbumTitle: "" });
        }}
        style={customStyles}
      >
        <div style={{ height: 50, width: "100%", padding: 7 }}>
          <Header>
            Add to Album
            <Header.Subheader>
              Add selected {this.props.selectedImageHashes.length} photo(s)
              to...
            </Header.Subheader>
          </Header>
        </div>
        <Divider fitted />
        <div
          style={{ height: 100, padding: 5, height: 50, overflowY: "hidden" }}
        >
          <Image.Group>
            {this.props.selectedImageHashes.map(image_hash => (
              <SecuredImageJWT
                isPublic={this.props.isPublic}
                height={40}
                width={40}
                src={
                  serverAddress +
                  "/media/square_thumbnails/" +
                  image_hash +
                  ".jpg"
                }
              />
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
            <Header as="h4">New album</Header>
            <Popup
              inverted
              content={
                'Album "' +
                this.state.newAlbumTitle.trim() +
                '" already exists.'
              }
              position="bottom center"
              open={this.props.albumsUserList
                .map(el => el.title.toLowerCase().trim())
                .includes(this.state.newAlbumTitle.toLowerCase().trim())}
              trigger={
                <Input
                  fluid
                  error={this.props.albumsUserList
                    .map(el => el.title.toLowerCase().trim())
                    .includes(this.state.newAlbumTitle.toLowerCase().trim())}
                  onChange={(e, v) => {
                    this.setState({ newAlbumTitle: v.value });
                  }}
                  placeholder="Album title"
                  action
                >
                  <input />
                  <Button
                    positive
                    onClick={() => {
                      this.props.dispatch(
                        createNewUserAlbum(
                          this.state.newAlbumTitle,
                          this.props.selectedImageHashes
                        )
                      );
                      this.props.onRequestClose();
                      this.setState({ newAlbumTitle: "" });
                    }}
                    disabled={this.props.albumsUserList
                      .map(el => el.title.toLowerCase().trim())
                      .includes(this.state.newAlbumTitle.toLowerCase().trim())}
                    type="submit"
                  >
                    Create
                  </Button>
                </Input>
              }
            />
          </div>
          <Divider />
          {filteredUserAlbumList.length > 0 &&
            filteredUserAlbumList.map(item => {
              return (
                <div
                  key={`useralbum_${item.id}`}
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
                        editUserAlbum(
                          item.id,
                          item.title,
                          this.props.selectedImageHashes
                        )
                      );
                      this.props.onRequestClose();
                    }}
                    as="a"
                  >
                    <SecuredImageJWT
                      isPublic={this.props.isPublic}
                      height={50}
                      width={50}
                      src={
                        item.cover_photos[0]
                          ? serverAddress +
                            "/media/square_thumbnails_small/" +
                            item.cover_photos[0].image_hash +
                            ".jpg"
                          : "/thumbnail_placeholder.png"
                      }
                    />
                    <Header.Content>
                      {item.title}
                      <Header.Subheader>
                        {item.photo_count} Item(s) <br />
                        {"Updated " + moment(item.created_on).fromNow()}
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

ModalAlbumEdit = connect(store => {
  return {
    albumsUserList: store.albums.albumsUserList,
    fetchingAlbumsUserList: store.albums.fetchingAlbumsUserList,
    fetchedAlbumsUserList: store.albums.fetchedAlbumsUserList
  };
})(ModalAlbumEdit);

PhotoListView = connect(store => {
  return {
    showSidebar: store.ui.showSidebar,
    gridType: store.ui.gridType,

    photos: store.photos.photos,
    fetchingPhotos: store.photos.fetchingPhotos,
    fetchedPhotos: store.photos.fetchedPhotos,

    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,

    route: store.routerReducer
  };
})(PhotoListView);
//photosGroupedByDate
//idx2hash
//title
//subtitle
//titleIconName
//titleIconColor
//isPublic
