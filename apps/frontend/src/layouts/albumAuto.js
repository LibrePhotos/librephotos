import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchAutoAlbumsList } from "../actions/albumsActions";
import { Icon, Header, Loader, Image } from "semantic-ui-react";
import { Grid, AutoSizer } from "react-virtualized";
import { serverAddress } from "../api_client/apiClient";
import LazyLoad from "react-lazyload";
import { searchPhotos } from "../actions/searchActions";
import { push } from "react-router-redux";
import store from "../store";
import { Link } from "react-router-dom";
import { SecuredImageJWT } from "../components/SecuredImage";


var topMenuHeight = 45; // don't change this
var SIDEBAR_WIDTH = 85;

export class AlbumAuto extends Component {
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
    if (this.props.albumsAutoList.length === 0) {
      this.props.dispatch(fetchAutoAlbumsList());
    }
  }

  calculateEntrySquareSize() {
    var numEntrySquaresPerRow = 6;
    if (window.innerWidth < 600) {
      numEntrySquaresPerRow = 2;
    } else if (window.innerWidth < 800) {
      numEntrySquaresPerRow = 3;
    } else if (window.innerWidth < 1000) {
      numEntrySquaresPerRow = 4;
    } else if (window.innerWidth < 1200) {
      numEntrySquaresPerRow = 5;
    } 

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15;

    var entrySquareSize = columnWidth / numEntrySquaresPerRow;
    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow
    });
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var albumAutoIndex =
      rowIndex * this.state.numEntrySquaresPerRow + columnIndex;
    if (albumAutoIndex < this.props.albumsAutoList.length) {
      return (
        <div key={key} style={style}>
          <div
            onClick={() => {
            }}
            style={{ padding: 5 }}
          >
            <SecuredImageJWT
              label={{ as: 'a', corner: 'left', icon: 'wizard' }}
              style={{ display: "inline-block" }}
              as={Link}
              to={`/event/${this.props.albumsAutoList[albumAutoIndex].id}`}
              width={this.state.entrySquareSize - 10}
              height={this.state.entrySquareSize - 10}
              src={
                serverAddress +
                "/media/square_thumbnails/" +
                this.props.albumsAutoList[albumAutoIndex].photos[0]+".jpg"
              }
            />
          </div>
          <div
            className="personCardName"
            style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}
          >
            <b>{this.props.albumsAutoList[albumAutoIndex].title}</b> <br />
            {this.props.albumsAutoList[albumAutoIndex].photos.length} Photo(s)
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
                Showing {this.props.albumsAutoList.length} Auto created albums
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
              rowHeight={this.state.entrySquareSize + 120}
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

AlbumAuto = connect(store => {
  return {
    auth: store.auth,
    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList
  };
})(AlbumAuto);