import React, { Component } from "react";
import { connect } from "react-redux";
import {
  Icon,
  Dropdown,
  Header,
  Button,
  Loader,
  Image,
  Flag,
  Grid as GridSUI
} from "semantic-ui-react";
import { serverAddress } from "../api_client/apiClient";
import LazyLoad from "react-lazyload";
import { fetchPlaceAlbumsList } from "../actions/albumsActions";
import { searchPhotos } from "../actions/searchActions";
import { push } from "react-router-redux";
import store from "../store";
import { Grid, AutoSizer } from "react-virtualized";
import { LocationClusterMap } from "../components/maps";
import { Link } from "react-router-dom";
import { SecuredImageJWT } from "../components/SecuredImage";
import { countryNames } from "../util/countryNames";
import _ from "lodash";


var topMenuHeight = 45; // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;

export class AlbumPlace extends Component {
  constructor() {
    super();
    this.state = {
      geolocationLevel: 1,
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: 200,
      showMap: false,
      gridHeight: window.innerHeight - topMenuHeight - 60,
      headerHeight: 60
    };
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this);
    this.cellRenderer = this.cellRenderer.bind(this);
  }

  componentWillMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize);
    if (this.props.albumsPlaceList.length === 0) {
      this.props.dispatch(fetchPlaceAlbumsList());
    }
  }

  componentWillUnmount() {
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
      ...this.state,
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow
    });
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var place = this.props.albumsPlaceListGroupedByGeolocationLevel[
      this.state.geolocationLevel
    ];
    var albumPlaceIndex =
      rowIndex * this.state.numEntrySquaresPerRow + columnIndex;
    if (albumPlaceIndex < place.length) {
      return (
        <div key={key} style={style}>
          <div
            onClick={() => {
              // store.dispatch(push(`/place/${this.props.albumsPlaceList[albumPlaceIndex].id}/`))
              // store.dispatch(searchPhotos(this.props.albumsPlaceList[albumPlaceIndex].title))
              // store.dispatch(push('/search'))
            }}
            style={{ padding: 5 }}
          >
            {place[albumPlaceIndex].cover_photos.slice(0, 1).map(photo => {
              return (
                <SecuredImageJWT
                  label={{ as: 'a', corner: 'left', icon: 'map marker alternate' }}
                  style={{ display: "inline-block", zIndex: 1 }}
                  width={this.state.entrySquareSize - 10}
                  height={this.state.entrySquareSize - 10}
                  as={Link}
                  to={`/place/${place[albumPlaceIndex].id}/`}
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
            {countryNames.includes(
              place[albumPlaceIndex].title.toLowerCase()
            ) ? (
              <Flag name={place[albumPlaceIndex].title.toLowerCase()} />
            ) : (
              ""
            )}
            <b>{place[albumPlaceIndex].title}</b>
            <br /> {place[albumPlaceIndex].photo_count} Photos
          </div>
        </div>
      );
    } else {
      return <div key={key} style={style} />;
    }
  };

  render() {
    var album = this.props.albumsPlaceListGroupedByGeolocationLevel[
      this.state.geolocationLevel
    ];
    var entrySquareSize = this.state.entrySquareSize;
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow;
    var geolocationLevelOptions = _
      .keys(this.props.albumsPlaceListGroupedByGeolocationLevel)
      .map(el => ({ key: el, value: el, text: "Location Level " + `${el}` }));
    return (
      <div>
        <div
          style={{
            position: "fixed",
            top: topMenuHeight + 10,
            right: 10,
            float: "right",
            zIndex: 10
          }}
        >
          <Dropdown
            className="icon"
            button
            labeled
            icon="filter"
            placeholder="Location Level"
            onChange={(e, { value }) =>
              this.setState({ geolocationLevel: value })
            }
            defaultValue={"1"}
            options={geolocationLevelOptions}
          />

          <Button
            active={this.state.showMap}
            color="blue"
            icon
            labelPosition="right"
            onClick={() => {
              this.setState({
                showMap: !this.state.showMap,
                gridHeight: !this.state.showMap
                  ? this.state.height - topMenuHeight - 260
                  : this.state.height - topMenuHeight - 60,
                headerHeight: !this.state.showMap ? 260 : 60
              });
            }}
            floated="right"
          >
            <Icon name="map" inverted />
            {this.state.showMap ? "Hide Map" : "Show Map"}
          </Button>
        </div>

        <div
          style={{
            height: this.state.headerHeight,
            paddingTop: 10,
            paddingRight: 5
          }}
        >
          <Header as="h2">
            <Icon name="map outline" />
            <Header.Content>
              Places{" "}
              <Loader
                size="tiny"
                inline
                active={this.props.fetchingAlbumsPlaceList}
              />
              <Header.Subheader>
                Showing top {this.props.albumsPlaceList.length} places
              </Header.Subheader>
            </Header.Content>
          </Header>

          {this.state.showMap && <LocationClusterMap height={200 - 20} />}
        </div>
        {album ? (
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
                height={this.state.gridHeight}
                rowHeight={this.state.entrySquareSize + 60}
                rowCount={Math.ceil(
                  this.props.albumsPlaceListGroupedByGeolocationLevel[
                    this.state.geolocationLevel
                  ].length / this.state.numEntrySquaresPerRow.toFixed(1)
                )}
                width={width}
              />
            )}
          </AutoSizer>
        ) : (
          <div />
        )}
      </div>
    );
  }
}

export class EntrySquare extends Component {
  render() {
    var images = this.props.coverPhotoUrls.map(function(coverPhotoUrl) {
      return (
        <SecuredImageJWT
          style={{ display: "inline-block" }}
          width={this.props.size / 2 - 20}
          height={this.props.size / 2 - 20}
          src={serverAddress + coverPhotoUrl}
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

AlbumPlace = connect(store => {
  return {
    albumsPlaceList: store.albums.albumsPlaceList,
    albumsPlaceListGroupedByGeolocationLevel:
      store.albums.albumsPlaceListGroupedByGeolocationLevel,
    fetchingAlbumsPlaceList: store.albums.fetchingAlbumsPlaceList,
    fetchedAlbumsPlaceList: store.albums.fetchedAlbumsPlaceList
  };
})(AlbumPlace);
