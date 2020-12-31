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
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

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
    var entrySquareSize = this.state.entrySquareSize;
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow;
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


// import React, { Component } from "react";
// import { connect } from "react-redux";
// import {
//   fetchPeopleAlbums,
//   fetchAutoAlbums,
//   generateAutoAlbums,
//   fetchAutoAlbumsList
// } from "../actions/albumsActions";
// import { AlbumAutoCard, AlbumAutoGallery } from "../components/album";
// import {
//   Container,
//   Icon,
//   Header,
//   Button,
//   Card,
//   Label,
//   Popup
// } from "semantic-ui-react";
// import {
//   fetchCountStats,
//   fetchPhotoScanStatus,
//   fetchAutoAlbumProcessingStatus
// } from "../actions/utilActions";
// import { SecuredImageJWT } from "../components/SecuredImage";

// import { Server, serverAddress } from "../api_client/apiClient";

// export class AlbumAuto extends Component {
//   componentWillMount() {
//     this.props.dispatch(fetchAutoAlbumsList());
//     var _dispatch = this.props.dispatch;
//     var intervalId = setInterval(function() {
//       _dispatch(fetchPhotoScanStatus());
//       _dispatch(fetchAutoAlbumProcessingStatus());
//     }, 2000);
//     this.setState({ intervalId: intervalId });
//   }

//   componentWillUnmount() {
//     clearInterval(this.state.intervalId);
//   }

//   handleAutoAlbumGen = e => this.props.dispatch(generateAutoAlbums());

//   render() {
//     if (this.props.fetchedAlbumsAutoList) {
//       var match = this.props.match;
//       var mappedAlbumCards = this.props.albumsAutoList.map(function(album) {
//         var albumTitle = album.title;
//         var albumDate = album.timestamp.split("T")[0];
//         try {
//           var albumCoverURL = album.cover_photo_url;
//         } catch (err) {
//           console.log(err);
//           var albumCoverURL = null;
//         }
//         return (
//           <AlbumAutoCard
//             match={match}
//             key={"album-auto-" + album.id}
//             albumTitle={albumTitle}
//             timestamp={albumDate}
//             people={album.people}
//             album_id={album.id}
//             albumCoverURL={serverAddress + albumCoverURL}
//             photoCount={album.photo_count}
//           />
//         );
//       });
//     } else {
//       var mappedAlbumCards = null;
//     }

//     return (
//       <div>
//         <Card.Group stackable itemsPerRow={this.props.itemsPerRow}>
//           {mappedAlbumCards}
//         </Card.Group>
//       </div>
//     );
//   }
// }

// AlbumAuto = connect(store => {
//   return {
//     albumsAuto: store.albums.albumsAuto,
//     fetchingAlbumsAuto: store.albums.fetchingAlbumsAuto,
//     fetchedAlbumsAuto: store.albums.fetchedAlbumsAuto,

//     albumsAutoList: store.albums.albumsAutoList,
//     fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
//     fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,

//     generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
//     generatedAlbumsAuto: store.albums.generatedAlbumsAuto,
//     statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
//     statusPhotoScan: store.util.statusPhotoScan,
//     scanningPhotos: store.photos.scanningPhotos
//   };
// })(AlbumAuto);
