import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchAutoAlbumsList } from "../actions/albumsActions";
import { Icon, Header, Image, Card, Loader } from "semantic-ui-react";
import { Grid, AutoSizer } from "react-virtualized";
import { serverAddress } from "../api_client/apiClient";
import * as moment from "moment";
import debounce from "lodash/debounce";
import { Link } from "react-router-dom";
import { SecuredImageJWT } from "../components/SecuredImage";

var topMenuHeight = 45; // don't change this
var leftMenuWidth = 85; // don't change this
var SIDEBAR_WIDTH = 85;
var timelineScrollWidth = 0;
var DAY_HEADER_HEIGHT = 35;

class ScrollSpeed {
  clear = () => {
    this.lastPosition = null;
    this.delta = 0;
  };
  getScrollSpeed(scrollOffset) {
    if (this.lastPosition != null) {
      this.delta = scrollOffset - this.lastPosition;
    }
    this.lastPosition = scrollOffset;

    window.clearTimeout(this._timeout);
    this._timeout = window.setTimeout(this.clear, 50);

    return this.delta;
  }
}

const SPEED_THRESHOLD = 1000; // Tweak this to whatever feels right for your app
const SCROLL_DEBOUNCE_DURATION = 100; // In milliseconds

export class AlbumAutoRV extends Component {
  constructor(props) {
    super(props);
    this.cellRenderer = this.cellRenderer.bind(this);
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this);
    this.state = {
      scrollToIndex: undefined,
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: 200,
      currTopRenderedCellIdx: 0,
      isScrollingFast: false
    };
  }
  getScrollSpeed = new ScrollSpeed().getScrollSpeed;

  handleScroll = ({ scrollTop }) => {
    // scrollSpeed represents the number of pixels scrolled since the last scroll event was fired
    const scrollSpeed = Math.abs(this.getScrollSpeed(scrollTop));

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

  componentWillMount() {
    this.props.dispatch(fetchAutoAlbumsList());
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
  }

  calculateEntrySquareSize() {
    if (window.innerWidth < 400) {
      var numEntrySquaresPerRow = 1;
    } else if (window.innerWidth < 600) {
      var numEntrySquaresPerRow = 2;
    } else if (window.innerWidth < 800) {
      var numEntrySquaresPerRow = 3;
    } else if (window.innerWidth < 1000) {
      var numEntrySquaresPerRow = 4;
    } else if (window.innerWidth < 1200) {
      var numEntrySquaresPerRow = 5;
    } else {
      var numEntrySquaresPerRow = 6;
    }

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 15;

    var entrySquareSize = columnWidth / numEntrySquaresPerRow;
    var numEntrySquaresPerRow = numEntrySquaresPerRow;
    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow
    });
    console.log("column width:", columnWidth);
    console.log("item size:", entrySquareSize);
    console.log("num items per row", numEntrySquaresPerRow);
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    const { isScrollingFast } = this.state;

    var albumAutoIndex =
      rowIndex * this.state.numEntrySquaresPerRow + columnIndex;
    if (albumAutoIndex < this.props.albumsAutoList.length) {
      if (!isScrollingFast) {
        var image = (
          <SecuredImageJWT
            height={this.props.entrySquareSize}
            width={this.props.entrySquareSize}
            src={
              serverAddress +
              "/media/square_thumbnails/" +
              this.props.albumsAutoList[albumAutoIndex].photos[0] +
              ".jpg"
            }
          />
        );
      } else {
        var image = (
          <Image
            height={this.props.entrySquareSize}
            width={this.props.entrySquareSize}
            src={"/thumbnail_placeholder.png"}
          />
        );
      }

      return (
        <div key={key} style={style}>
          <div style={{ padding: 10 }}>
            <Card
              as={Link}
              to={`/event/${this.props.albumsAutoList[albumAutoIndex].id}`}
              style={{ height: this.state.entrySquareSize + 110 }}
            >
              {image}
              <Card.Content>
                <Card.Header>
                  {moment(
                    this.props.albumsAutoList[albumAutoIndex].timestamp
                  ).format("MMMM YYYY")}
                </Card.Header>
                <Card.Meta>
                  {this.props.albumsAutoList[albumAutoIndex].photos.length}{" "}
                  Items
                </Card.Meta>
                <Card.Description>
                  {this.props.albumsAutoList[albumAutoIndex].title}
                </Card.Description>
              </Card.Content>
            </Card>
          </div>
        </div>
      );
    } else {
      return <div key={key} style={style} />;
    }
  };

  render() {
    return (
      <div>
        <div style={{ height: 60, paddingTop: 10 }}>
          <Header as="h2">
            <Icon name="wizard" />
            <Header.Content>
              Events{" "}
              <Loader
                size="tiny"
                inline
                active={this.props.fetchingAlbumsAutoList}
              />
              <Header.Subheader>
                {this.props.albumsAutoList.length} Events
              </Header.Subheader>
            </Header.Content>
          </Header>
        </div>

        <AutoSizer
          disableHeight
          style={{ outline: "none", padding: 0, margin: 0 }}
        >
          {({ width }) => (
            <Grid
              style={{ outline: "none" }}
              headerHeight={100}
              onScroll={this.handleScroll}
              disableHeader={false}
              cellRenderer={this.cellRenderer}
              columnWidth={this.state.entrySquareSize}
              columnCount={this.state.numEntrySquaresPerRow}
              height={this.state.height - topMenuHeight - 60}
              rowHeight={this.state.entrySquareSize + 130}
              rowCount={Math.ceil(
                this.props.albumsAutoList.length /
                  this.state.numEntrySquaresPerRow.toFixed(1)
              )}
              width={width}
            />
          )}
        </AutoSizer>
      </div>
    );
  }
}

AlbumAutoRV = connect(store => {
  return {
    albumsAuto: store.albums.albumsAuto,
    fetchingAlbumsAuto: store.albums.fetchingAlbumsAuto,
    fetchedAlbumsAuto: store.albums.fetchedAlbumsAuto,

    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,

    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    generatedAlbumsAuto: store.albums.generatedAlbumsAuto,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    statusPhotoScan: store.util.statusPhotoScan,
    scanningPhotos: store.photos.scanningPhotos
  };
})(AlbumAutoRV);
