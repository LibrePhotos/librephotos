import React, { Component } from "react";
import { connect } from "react-redux";
import { Icon, Header, Loader, Image } from "semantic-ui-react";
import { Grid, AutoSizer } from "react-virtualized";
import { serverAddress } from "../api_client/apiClient";
import LazyLoad from "react-lazyload";
import { fetchThingAlbumsList } from "../actions/albumsActions";
import { searchPhotos } from "../actions/searchActions";
import { push } from "react-router-redux";
import store from "../store";
import { SecuredImageJWT } from "../components/SecuredImage";


var topMenuHeight = 45; // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;

export class AlbumThing extends Component {
  constructor() {
    super();
    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: 200
    });
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this);
    this.cellRenderer = this.cellRenderer.bind(this);
  }

  componentWillMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize);
    if (this.props.albumsThingList.length === 0) {
      this.props.dispatch(fetchThingAlbumsList());
    }
  }

  componentWillUnount() {
    window.removeEventListener("resize", this.calculateEntrySquareSize);
  }

  calculateEntrySquareSize() {
    if (window.innerWidth < 600) {
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

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15;

    var entrySquareSize = columnWidth / numEntrySquaresPerRow;
    var numEntrySquaresPerRow = numEntrySquaresPerRow;
    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow
    });
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var albumThingIndex =
      rowIndex * this.state.numEntrySquaresPerRow + columnIndex;
    if (albumThingIndex < this.props.albumsThingList.length) {
      return (
        <div key={key} style={style}>
          <div
            onClick={() => {
              store.dispatch(
                searchPhotos(this.props.albumsThingList[albumThingIndex].title)
              );
              store.dispatch(push("/search"));
            }}
            style={{ padding: 5 }}
          >
            {this.props.albumsThingList[albumThingIndex].cover_photos
              .slice(0, 1)
              .map(photo => {
                return (
                  <SecuredImageJWT
                    label={{ as: 'a', corner: 'left', icon: 'tag' }}
                    style={{ display: "inline-block" }}
                    width={this.state.entrySquareSize - 10}
                    height={this.state.entrySquareSize - 10}
                    src={
                      serverAddress +
                      "/media/square_thumbnails/" +
                      photo.image_hash +
                      ".jpg"
                    }
                  />
                );
              })}
          </div>
          <div style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
            
            <b>{this.props.albumsThingList[albumThingIndex].title}</b>
            <br />
            {this.props.albumsThingList[albumThingIndex].photo_count} Photos
          </div>
        </div>
      );
    } else {
      return <div key={key} style={style} />;
    }
  };

  render() {
    var entrySquareSize = this.state.entrySquareSize;
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow;
    return (
      <div>
        <div style={{ height: 60, paddingTop: 10 }}>
          <Header as="h2">
            <Icon name="tags" />
            <Header.Content>
              Things{" "}
              <Loader
                size="tiny"
                inline
                active={this.props.fetchingAlbumsThingList}
              />
              <Header.Subheader>
                Showing top {this.props.albumsThingList.length} things
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
              disableHeader={false}
              cellRenderer={this.cellRenderer}
              columnWidth={this.state.entrySquareSize}
              columnCount={this.state.numEntrySquaresPerRow}
              height={this.state.height - topMenuHeight - 60}
              rowHeight={this.state.entrySquareSize + 60}
              rowCount={Math.ceil(
                this.props.albumsThingList.length /
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

export class EntrySquare extends Component {
  render() {
    var images = this.props.cover_photos.map(function(photo) {
      return (
        <SecuredImageJWT
          style={{ display: "inline-block" }}
          width={this.props.size / 2 - 20}
          height={this.props.size / 2 - 20}
          src={
            serverAddress +
            "/media/square_thumbnails/" +
            photo.image_hash +
            ".jpg"
          }
        />
      );
    }, this);
    return (
      <div
        style={{
          width: this.props.size,
          display: "inline-block",
          paddingLeft: 10,
          paddingRight: 10
        }}
        onClick={() => {
          store.dispatch(searchPhotos(this.props.title));
          store.dispatch(push("/search"));
        }}
      >
        <div style={{ height: this.props.size }}>
          <LazyLoad
            once={true}
            unmountIfInvisible={true}
            height={this.props.size}
          >
            <Image.Group>{images}</Image.Group>
          </LazyLoad>
        </div>
        <div style={{ height: 100 }}>
          <b>{this.props.title}</b> ({this.props.photoCount})
        </div>
      </div>
    );
  }
}

AlbumThing = connect(store => {
  return {
    albumsThingList: store.albums.albumsThingList,
    fetchingAlbumsThingList: store.albums.fetchingAlbumsThingList,
    fetchedAlbumsThingList: store.albums.fetchedAlbumsThingList
  };
})(AlbumThing);
