import React, { Component } from "react";
import {
  Header,
  Image,
  Icon,
  Grid as SUGrid,
  Menu,
  Loader,
  Label
} from "semantic-ui-react";
import { fetchPhotosSharedToMe, fetchPhotosSharedFromMe } from "../actions/photosActions";
import { fetchPublicUserList } from "../actions/publicActions";
import { fetchUserAlbumsSharedToMe } from "../actions/albumsActions";
import { connect } from "react-redux";
import _ from "lodash";
import { Link } from "react-router-dom";
import { serverAddress } from "../api_client/apiClient";
import { SecuredImageJWT } from "../components/SecuredImage";
import { Grid, AutoSizer } from "react-virtualized";
import {
  calculateGridCellSize,
  calculateSharedPhotoGridCells,
  calculateSharedAlbumGridCells
} from "../util/gridUtils";
import { ScrollSpeed, SCROLL_DEBOUNCE_DURATION } from "../util/scrollUtils";
import debounce from "lodash/debounce";


var TOP_MENU_HEIGHT = 45; // don't change this
var LEFT_MENU_WIDTH = 85; // don't change this
const SPEED_THRESHOLD = 300;
var SIDEBAR_WIDTH = 85;
var DAY_HEADER_HEIGHT = 70;

export class SharedToMe extends Component {
  state = {
    activeItem: this.props.match.params.which,
    entrySquareSize: 200,
    numEntrySquaresPerRow: 10,
    photoGridContents: null,
    albumGridContents: null,
    isScrollingFast: false,
    topRowOwner: null,
  };

  constructor(props) {
    super(props);
    this.photoGridRef = React.createRef();
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
    this.props.dispatch(fetchPublicUserList());
    this.props.dispatch(fetchPhotosSharedToMe());
    this.props.dispatch(fetchPhotosSharedFromMe());
    this.props.dispatch(fetchUserAlbumsSharedToMe());
    this.handleResize();
    window.addEventListener("resize", this.handleResize.bind(this));
  }
  handleItemClick = (e, { name }) => this.setState({ activeItem: name });

  static getDerivedStateFromProps(nextProps, prevState) {
    var photoGridContents = calculateSharedPhotoGridCells(
      nextProps.photos.photosSharedToMe,
      prevState.numEntrySquaresPerRow
    ).cellContents;

    const albumGridContents = calculateSharedAlbumGridCells(
      nextProps.albums.albumsSharedToMe,
      prevState.numEntrySquaresPerRow
    ).cellContents;

    return {
      activeItem: nextProps.match.params.which,
      photoGridContents: photoGridContents,
      albumGridContents: albumGridContents
    };
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

    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow
    });
    if (this.photoGridRef.current) {
      this.photoGridRef.current.recomputeGridSize();
    }
  }

  photoCellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var cell = this.state.photoGridContents[rowIndex][columnIndex];
    if (this.state.photoGridContents[rowIndex][columnIndex]) {
      // non empty cell
      const cell = this.state.photoGridContents[rowIndex][columnIndex];
      if (cell.user_id) {
        // sharer info header
        const owner = this.props.pub.publicUserList.filter(
          e => e.id === cell.user_id
        )[0];
        if (owner && owner.last_name.length + owner.first_name.length > 0) {
          var displayName = owner.first_name + " " + owner.last_name;
        } else if (owner) {
          var displayName = owner.username;
        } else {
          var displayName = cell.user_id;
        }
        return (
          <div
            key={key}
            style={{
              ...style,
              width: this.state.width,
              height: DAY_HEADER_HEIGHT,
              paddingTop: 15,
              paddingLeft: 5
            }}
          >
            <Header as="h3">
              <Icon name="user circle outline" />
              <Header.Content>
                {displayName}
                <Header.Subheader>
                  <Icon name="photo" />
                  shared {cell.photos.length} photos with you
                </Header.Subheader>
              </Header.Content>
            </Header>
          </div>
        );
      } else {
        // photo cell
        return (
          <div key={key} style={{ ...style, padding: 1 }}>
            {this.state.isScrollingFast ? (
              <div
                style={{
                  margin: 1,
                  backgroundColor: "#dddddd",
                  width: this.state.entrySquareSize - 2,
                  height: this.state.entrySquareSize - 2
                }}
              />
            ) : (
              <SecuredImageJWT
                width={this.state.entrySquareSize - 2}
                height={this.state.entrySquareSize - 2}
                src={
                  serverAddress +
                  "/media/square_thumbnails/" +
                  cell.image_hash +
                  ".jpg"
                }
              />
            )}
          </div>
        );
      }
    } else {
      // empty cell
      return <div key={key} style={style} />;
    }
  };

  albumCellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var cell = this.state.albumGridContents[rowIndex][columnIndex];
    if (this.state.albumGridContents[rowIndex][columnIndex]) {
      // non empty cell
      const cell = this.state.albumGridContents[rowIndex][columnIndex];
      if (cell.user_id) {
        // sharer info header
        const owner = this.props.pub.publicUserList.filter(
          e => e.id === cell.user_id
        )[0];
        if (owner && owner.last_name.length + owner.first_name.length > 0) {
          var displayName = owner.first_name + " " + owner.last_name;
        } else if (owner) {
          var displayName = owner.username;
        } else {
          var displayName = cell.user_id;
        }
        return (
          <div
            key={key}
            style={{
              ...style,
              width: this.state.width,
              height: DAY_HEADER_HEIGHT,
              paddingTop: 15,
              paddingLeft: 5
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
      } else {
        // photo cell
        return (
          <div key={key} style={{ ...style, padding: 1 }}>
            <SecuredImageJWT
              label={{
                as: "a",
                corner: "left",
                icon: "bookmark",
                color: "red"
              }}
              as={Link}
              to={`/useralbum/${cell.id}/`}
              width={this.state.entrySquareSize - 2}
              height={this.state.entrySquareSize - 2}
              src={
                serverAddress +
                "/media/square_thumbnails/" +
                cell.cover_photos[0].image_hash +
                ".jpg"
              }
            />
            <div style={{ height: 40, paddingLeft: 10, paddingTop: 5 }}>
              <b>{cell.title}</b>
              <br />
              {cell.photo_count} photo(s)
            </div>
          </div>
        );
      }
    } else {
      // empty cell
      return <div key={key} style={style} />;
    }
  };

  render() {
    const { activeItem } = this.state;

    if (activeItem === "photos") {
      var subheader = (
        <Header.Subheader>
          {this.props.photos.photosSharedToMe.length} user(s) shared{" "}
          {this.props.photos.photosSharedToMe.length > 0 &&
            this.props.photos.photosSharedToMe
              .map(el => el.photos.length)
              .reduce((a, b) => a + b)}{" "}
          photo(s) with you
        </Header.Subheader>
      );
      var totalListHeight = this.state.photoGridContents
        .map((row, index) => {
          if (row[0].user_id) {
            //header row
            return DAY_HEADER_HEIGHT;
          } else {
            //photo row
            return this.state.entrySquareSize;
          }
        })
        .reduce((a, b) => a + b, 0);
    } else {
      var subheader = (
        <Header.Subheader>
          {this.props.albums.albumsSharedToMe.length} user(s) shared{" "}
          {this.props.albums.albumsSharedToMe.length > 0 &&
            this.props.albums.albumsSharedToMe
              .map(el => el.albums.length)
              .reduce((a, b) => a + b)}{" "}
          album(s) with you
        </Header.Subheader>
      );
      var totalListHeight = this.state.albumGridContents
        .map((row, index) => {
          if (row[0].user_id) {
            //header row
            return DAY_HEADER_HEIGHT;
          } else {
            //photo row
            return this.state.entrySquareSize + 40;
          }
        })
        .reduce((a, b) => a + b, 0);
    }
    return (
      <div>
        <div style={{ height: 60, paddingTop: 10 }}>
          <Header as="h2">
            <Icon.Group size="big">
              <Icon
                name={activeItem==='photos' ? "image outline" :'images outline'}/>
              <Icon
                corner
                name="share"
                color="green"
                size='mimi'
              />
            </Icon.Group>
            <Header.Content style={{paddingLeft:10}}>
              {activeItem === "photos" ? "Photos" : "Albums"} others shared{" "}
              {subheader}
            </Header.Content>
          </Header>
        </div>
        <div style={{ marginLeft: -5, height: 40 }}>
          <Menu pointing secondary>
            <Menu.Item
              as={Link}
              to="/shared/tome/photos/"
              name="photos"
              active={activeItem === "photos"}
            >
              {"Photos "} <Loader size="mini" inline />
            </Menu.Item>
            <Menu.Item
              as={Link}
              to="/shared/tome/albums/"
              name="albums"
              active={activeItem === "albums"}
            >
              {"Albums "} <Loader size="mini" inline />
            </Menu.Item>
          </Menu>
        </div>
        <div
          style={{
            right: 0,
            top: TOP_MENU_HEIGHT + 60,
            position: "fixed",
            padding: 5
          }}
        >
          {this.state.topRowOwner && <Label basic>Shared by: {this.state.topRowOwner}</Label>}
        </div>

        {activeItem === "photos" && this.state.photoGridContents.length === 0}

        {activeItem === "photos" &&
          this.props.photos.fetchingPhotosSharedToMe &&
          !this.props.photos.fetchedPhotosSharedToMe && (
            <Loader active>Loading photos shared with you...</Loader>
          )}

        {activeItem === "photos" &&
          this.state.photoGridContents.length === 0 &&
          this.props.photos.fetchedPhotosSharedToMe && (
            <div>No one has shared any photos with you yet.</div>
          )}

        {activeItem === "photos" &&
          this.state.photoGridContents.length > 0 &&
          this.state.photoGridContents && (
            <div>
              <AutoSizer
                disableHeight
                style={{ outline: "none", padding: 0, margin: 0 }}
              >
                {({ width }) => (
                  <Grid
                    ref={this.photoGridRef}
                    onSectionRendered={({ rowStartIndex }) => {
                      const cell = this.state.photoGridContents[rowStartIndex][0]
                      if (cell.user_id) {
                        var owner = cell.photos[0].owner.username
                      } else {
                        var owner = cell.owner.username
                      }
                      this.setState({topRowOwner:owner})
                    }}
                    style={{ outline: "none" }}
                    disableHeader={false}
                    onScroll={this.handleScroll}
                    cellRenderer={this.photoCellRenderer}
                    columnWidth={this.state.entrySquareSize}
                    columnCount={this.state.numEntrySquaresPerRow}
                    height={this.state.height - 45 - 60 - 40}
                    rowHeight={this.state.entrySquareSize}
                    rowCount={this.state.photoGridContents.length}
                    rowHeight={({ index }) => {
                      if (this.state.photoGridContents[index][0].user_id) {
                        //header row
                        return DAY_HEADER_HEIGHT;
                      } else {
                        //photo row
                        return this.state.entrySquareSize;
                      }
                    }}
                    estimatedRowSize={
                      totalListHeight /
                      this.state.photoGridContents.length.toFixed(1)
                    }
                    width={width}
                  />
                )}
              </AutoSizer>
            </div>
          )}

        {activeItem === "albums" &&
          this.props.albums.fetchingAlbumsSharedToMe &&
          !this.props.albums.fetchedAlbumsSharedToMe && (
            <Loader active>Loading albums shared with you...</Loader>
          )}

        {activeItem === "albums" &&
          this.state.albumGridContents.length === 0 &&
          this.props.albums.fetchedAlbumsSharedToMe && (
            <div>No one has shared any albums with you yet.</div>
          )}

        {activeItem === "albums" &&
          this.props.albums.fetchedAlbumsSharedToMe &&
          this.state.albumGridContents.length > 0 && (
            <div>
              <AutoSizer
                disableHeight
                style={{ outline: "none", padding: 0, margin: 0 }}
              >
                {({ width }) => (
                  <Grid
                    ref={this.photoGridRef}
                    onSectionRendered={({ rowStartIndex }) => {
                      const cell = this.state.albumGridContents[rowStartIndex][0]
                      if (cell.user_id) {
                        var owner = cell.albums[0].owner.username
                      } else {
                        var owner = cell.owner.username
                      }
                      this.setState({topRowOwner:owner})
                    }}
                    style={{ outline: "none" }}
                    disableHeader={false}
                    onScroll={this.handleScroll}
                    cellRenderer={this.albumCellRenderer}
                    columnWidth={this.state.entrySquareSize}
                    columnCount={this.state.numEntrySquaresPerRow}
                    height={this.state.height - 45 - 60 - 40}
                    rowHeight={this.state.entrySquareSize}
                    rowCount={this.state.albumGridContents.length}
                    rowHeight={({ index }) => {
                      if (this.state.albumGridContents[index][0].user_id) {
                        //header row
                        return DAY_HEADER_HEIGHT;
                      } else {
                        //photo row
                        return this.state.entrySquareSize + 40;
                      }
                    }}
                    estimatedRowSize={
                      totalListHeight /
                      this.state.albumGridContents.length.toFixed(1)
                    }
                    width={width}
                  />
                )}
              </AutoSizer>
            </div>
          )}

        {false &&
          activeItem === "photos" && (
            <div style={{ paddingTop: 13, paddingLeft: 10, paddingRight: 10 }}>
              {this.props.photos.photosSharedToMe.map((el, idx) => {
                const owner = this.props.pub.publicUserList.filter(
                  e => e.id === el.user_id
                )[0];
                if (
                  owner &&
                  owner.last_name.length + owner.first_name.length > 0
                ) {
                  var displayName = owner.first_name + " " + owner.last_name;
                } else if (owner) {
                  var displayName = owner.username;
                } else {
                  var displayName = el.user_id;
                }

                return (
                  <div style={{ padding: 10 }}>
                    <Header>
                      <Image circular src="/unknown_user.jpg" />
                      <Header.Content>
                        {displayName}
                        <Header.Subheader>
                          shared {el.photos.length} photos
                        </Header.Subheader>
                      </Header.Content>
                    </Header>
                    {true && (
                      <div>
                        <SUGrid doubling unstackable>
                          <SUGrid.Row
                            columns={this.props.ui.gridType === "dense" ? 5 : 3}
                          >
                            {el.photos
                              //.slice(
                              //  0,
                              //  this.props.ui.gridType === "dense" ? 5 : 3
                              //)
                              .map(photo => (
                                <SUGrid.Column>
                                  <SecuredImageJWT
                                    src={
                                      serverAddress +
                                      "/media/square_thumbnails/" +
                                      photo.image_hash +
                                      ".jpg"
                                    }
                                  />
                                </SUGrid.Column>
                              ))}
                          </SUGrid.Row>
                        </SUGrid>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        {false &&
          activeItem === "albums" && (
            <div style={{ paddingTop: 13, paddingLeft: 10, paddingRight: 10 }}>
              {this.props.albums.albumsSharedToMe.map((el, idx) => {
                const owner = this.props.pub.publicUserList.filter(
                  e => e.id === el.user_id
                )[0];
                if (
                  owner &&
                  owner.last_name.length + owner.first_name.length > 0
                ) {
                  var displayName = owner.first_name + " " + owner.last_name;
                } else if (owner) {
                  var displayName = owner.username;
                } else {
                  var displayName = el.user_id;
                }

                return (
                  <div style={{ padding: 10 }}>
                    <Header>
                      <Image circular src="/unknown_user.jpg" />
                      <Header.Content>
                        {displayName}
                        <Header.Subheader>
                          shared {el.albums.length} albums
                        </Header.Subheader>
                      </Header.Content>
                    </Header>
                    {true && (
                      <div>
                        <SUGrid doubling unstackable>
                          <SUGrid.Row
                            columns={this.props.ui.gridType === "dense" ? 5 : 3}
                          >
                            {el.albums
                              //.slice(
                              //  0,
                              //  this.props.ui.gridType === "dense" ? 5 : 3
                              //)
                              .map(album => (
                                <SUGrid.Column>
                                  <SecuredImageJWT
                                    as={Link}
                                    to={`/useralbum/${album.id}/`}
                                    label={{
                                      as: "a",
                                      corner: "left",
                                      icon: "bookmark",
                                      color: "red"
                                    }}
                                    src={
                                      serverAddress +
                                      "/media/square_thumbnails/" +
                                      album.cover_photos[0].image_hash +
                                      ".jpg"
                                    }
                                  />
                                  <div
                                    style={{
                                      paddingLeft: 15,
                                      paddingRight: 15,
                                      paddingTop: 5
                                    }}
                                  >
                                    <b>{album.title}</b>
                                    <br />
                                    {album.photo_count} Photos
                                  </div>
                                </SUGrid.Column>
                              ))}
                          </SUGrid.Row>
                        </SUGrid>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>
    );
  }
}

SharedToMe = connect(store => {
  return {
    showSidebar: store.ui.showSidebar,
    pub: store.pub,
    ui: store.ui,
    auth: store.auth,
    photos: store.photos,
    albums: store.albums
  };
})(SharedToMe);
