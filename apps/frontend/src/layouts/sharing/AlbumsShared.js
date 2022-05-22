import { Anchor, Image, Text } from "@mantine/core";
import debounce from "lodash/debounce";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";
import { Header, Icon, Loader } from "semantic-ui-react";

import { serverAddress } from "../../api_client/apiClient";
import {
  calculateGridCellSize,
  calculateSharedAlbumGridCells,
  calculateSharedPhotoGridCells,
} from "../../util/gridUtils";
import { SCROLL_DEBOUNCE_DURATION, ScrollSpeed } from "../../util/scrollUtils";

const SPEED_THRESHOLD = 300;
const SIDEBAR_WIDTH = 85;
const DAY_HEADER_HEIGHT = 70;

export class AlbumsShared extends Component {
  state = {
    entrySquareSize: 200,
    numEntrySquaresPerRow: 10,
    photoGridContents: null,
    albumGridContents: null,
    isScrollingFast: false,
    topRowOwner: null,
    isSharedToMe: this.props.isSharedToMe,
  };

  constructor(props) {
    super(props);
    this.photoGridRef = React.createRef();
  }

  scrollSpeedHandler = new ScrollSpeed();

  handleScroll = ({ scrollTop }) => {
    // scrollSpeed represents the number of pixels scrolled since the last scroll event was fired
    const scrollSpeed = Math.abs(this.scrollSpeedHandler.getScrollSpeed(scrollTop));

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
    window.addEventListener("resize", this.handleResize.bind(this));
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    let albumGridContents;
    if (prevState.isSharedToMe) {
      albumGridContents = calculateSharedAlbumGridCells(
        nextProps.albums.albumsSharedToMe,
        prevState.numEntrySquaresPerRow
      ).cellContents;
    } else {
      albumGridContents = calculateSharedPhotoGridCells(
        nextProps.albums.albumsSharedToMe,
        prevState.numEntrySquaresPerRow
      ).cellContents;
    }

    return {
      albumGridContents: albumGridContents,
    };
  }

  handleResize() {
    let columnWidth = 0;
    if (this.props.showSidebar) {
      columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10;
    } else {
      columnWidth = window.innerWidth - 5 - 5 - 10;
    }

    const { entrySquareSize, numEntrySquaresPerRow } = calculateGridCellSize(columnWidth);

    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow,
    });
    if (this.photoGridRef.current) {
      this.photoGridRef.current.recomputeGridSize();
    }
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    if (this.state.albumGridContents[rowIndex][columnIndex]) {
      // non empty cell
      const cell = this.state.albumGridContents[rowIndex][columnIndex];
      if (cell.user_id) {
        // sharer info header
        const owner = this.props.pub.publicUserList.filter(e => e.id === cell.user_id)[0];
        let displayName = cell.user_id;
        if (owner && owner.last_name.length + owner.first_name.length > 0) {
          displayName = `${owner.first_name} ${owner.last_name}`;
        } else if (owner) {
          displayName = owner.username;
        }
        return (
          <div
            key={key}
            style={{
              ...style,
              width: this.state.width,
              height: DAY_HEADER_HEIGHT,
              paddingTop: 15,
              paddingLeft: 5,
            }}
          >
            <Header as="h3">
              <Icon name="user circle outline" />
              <Header.Content>
                {displayName}
                <Header.Subheader>
                  <Icon name="images" />
                  shared {cell.albums.length} albums with you
                </Header.Subheader>
              </Header.Content>
            </Header>
          </div>
        );
      }
      // photo cell
      return (
        <div key={key} style={{ ...style, padding: 1 }}>
          <Anchor href={`/useralbum/${cell.id}/`}>
            <Image
              width={this.state.entrySquareSize - 2}
              height={this.state.entrySquareSize - 2}
              src={`${serverAddress}/media/square_thumbnails/${cell.cover_photos[0].image_hash}`}
            />
          </Anchor>
          <Text weight={700}>{cell.title}</Text>
          <Text size="sm" color="dimmed">
            {cell.photo_count} photo(s)
          </Text>
        </div>
      );
    }
    // empty cell
    return <div key={key} style={style} />;
  };

  render() {
    const totalListHeight = this.state.albumGridContents
      .map((row, index) => {
        if (row[0].user_id) {
          // header row
          return DAY_HEADER_HEIGHT;
        }
        // photo row
        return this.state.entrySquareSize + 40;
      })
      .reduce((a, b) => a + b, 0);

    return (
      <div>
        {this.props.albums.fetchingAlbumsSharedToMe && !this.props.albums.fetchedAlbumsSharedToMe && (
          <Loader active>Loading albums shared with you...</Loader>
        )}
        {this.props.albums.fetchingAlbumsSharedFromMe && !this.props.albums.fetchedAlbumsSharedFromMe && (
          <Loader active>Loading albums shared by you...</Loader>
        )}

        {this.state.albumGridContents.length === 0 && this.props.albums.fetchedAlbumsSharedToMe && (
          <div>No one has shared any albums with you yet.</div>
        )}

        {this.state.albumGridContents.length === 0 && this.props.albums.fetchedAlbumsSharedFromMe && (
          <div>You have not shared any albums yet.</div>
        )}

        {(this.props.albums.fetchedAlbumsSharedToMe || this.props.albums.fetchedAlbumsSharedFromMe) &&
          this.state.albumGridContents.length > 0 && (
            <div>
              <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
                {({ width }) => (
                  <Grid
                    ref={this.photoGridRef}
                    onSectionRendered={({ rowStartIndex }) => {
                      const cell = this.state.albumGridContents[rowStartIndex][0];
                      let owner = "";
                      if (cell.user_id) {
                        owner = cell.albums[0].owner.username;
                      } else {
                        owner = cell.owner.username;
                      }
                      this.setState({ topRowOwner: owner });
                    }}
                    style={{ outline: "none" }}
                    disableHeader={false}
                    onScroll={this.handleScroll}
                    cellRenderer={this.cellRenderer}
                    columnWidth={this.state.entrySquareSize}
                    columnCount={this.state.numEntrySquaresPerRow}
                    height={this.state.height - 45 - 60 - 40}
                    rowCount={this.state.albumGridContents.length}
                    rowHeight={({ index }) => {
                      if (this.state.albumGridContents[index][0].user_id) {
                        // header row
                        return DAY_HEADER_HEIGHT;
                      }
                      // photo row
                      return this.state.entrySquareSize + 40;
                    }}
                    estimatedRowSize={totalListHeight / this.state.albumGridContents.length.toFixed(1)}
                    width={width}
                  />
                )}
              </AutoSizer>
            </div>
          )}
      </div>
    );
  }
}

AlbumsShared = connect(store => ({
  showSidebar: store.ui.showSidebar,
  pub: store.pub,
  ui: store.ui,
  auth: store.auth,
  photos: store.photos,
  albums: store.albums,
}))(AlbumsShared);
