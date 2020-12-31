import React, { Component } from "react";
import { connect } from "react-redux";
import { Loader, Flag, Segment, Image, Header, Icon } from "semantic-ui-react";
import { Map, TileLayer, Marker, Popup } from "react-leaflet";
import { fetchPhotos } from "../actions/photosActions";
import { fetchAutoAlbumsList } from "../actions/albumsActions";
import { fetchLocationClusters } from "../actions/utilActions";
import { serverAddress } from "../api_client/apiClient";
import MarkerClusterGroup from "react-leaflet-markercluster";
import { fetchPlaceAlbumsList } from "../actions/albumsActions";
import { Grid, AutoSizer } from "react-virtualized";
import { countryNames } from "../util/countryNames";
import { Link } from "react-router-dom";
import { SecuredImageJWT } from "../components/SecuredImage";
import _ from "lodash";


var topMenuHeight = 45; // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;

export class LocationMap extends Component {

  constructor(props) {
    super(props);
    this.mapRef = React.createRef();
  }

  componentDidMount() {
    console.log("Map was just set visible.");

    var resizeDone = false

    // attempt resize 8 times; mapRef.current might be undefined
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        if (!resizeDone) {
          if (this.mapRef.current) {
            const map = this.mapRef.current.leafletElement;
            map.invalidateSize(true);
            resizeDone = true
            console.log('Map resized.')
          }
        }
      }, 1000*(i+1));
    };
  }

    onViewportChanged = viewport => {
    console.log('Viewport changed, mapping new photo location: ', viewport.center);
    this.setState({ viewport });

    const map = this.mapRef.current.leafletElement;
    map.invalidateSize(true);
  };

  render() {
    var photosWithGPS = this.props.photos.filter(function(photo) {
      if (photo.exif_gps_lon !== null && photo.exif_gps_lon) {
        return true;
      } else {
        return false;
      }
    });

    var sum_lat = 0;
    var sum_lon = 0;
    for (var i = 0; i < photosWithGPS.length; i++) {
      sum_lat += parseFloat(photosWithGPS[i].exif_gps_lat);
      sum_lon += parseFloat(photosWithGPS[i].exif_gps_lon);
    }
    var avg_lat = sum_lat / photosWithGPS.length;
    var avg_lon = sum_lon / photosWithGPS.length;

    var markers = photosWithGPS.map(function(photo) {
      return (
        <Marker
          key={photo.image_hash}
          position={[photo.exif_gps_lat, photo.exif_gps_lon]}
        >
          <Popup>
            <div>
              <Image src={photo.square_thumbnail} />
            </div>
          </Popup>
        </Marker>
      );
    });

    console.log(markers);

    if (photosWithGPS.length > 0) {
      if (this.props.zoom) {
        var zoom = this.props.zoom;
      } else {
        var zoom = 2;
      }
      return (
        <Segment style={{ zIndex: 2, height: this.props.height, padding: 0 }}>
          <Map
            ref={this.mapRef}
            style={{ height: this.props.height }}
            center={[avg_lat, avg_lon]}
            zoom={zoom}
          >
            <TileLayer
              attribution="&copy; <a href=&quot;https://osm.org/copyright&quot;>OpenStreetMap</a> contributors"
              url="https://{s}.tile.osm.org/{z}/{x}/{y}.png"
            />
            {markers}
          </Map>
        </Segment>
      );
    } else {
      return (
        <Segment style={{ height: this.props.height }}>
          <Loader active>Map loading...</Loader>
        </Segment>
      );
    }
  }
}

export class EventMap extends Component {
  constructor(props) {
    super(props);
    this.mapRef = React.createRef();
    this.preprocess = this.preprocess.bind(this);
  }

  componentDidMount() {
    this.props.dispatch(fetchAutoAlbumsList());

    console.log("Map was just made visible.");

    var resizeDone = false

    // attempt resize 8 times; mapRef.current might be undefined
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        if (!resizeDone) {
          if (this.mapRef.current) {
            const map = this.mapRef.current.leafletElement;
            map.invalidateSize(true);
            resizeDone = true
            console.log('Map resized.')
          }
        }
      }, 1000*(i+1));
    };
  }

  onViewportChanged = viewport => {
    console.log('Viewport changed, mapping new photo location: ', viewport.center);
    this.setState({ viewport });

    const map = this.mapRef.current.leafletElement;
    map.invalidateSize(true);
  };

  preprocess() {
    var eventsWithGPS = this.props.albumsAutoList.filter(function(album) {
      if (album.gps_lat != null && album.gps_lon != null) {
        return true;
      } else {
        return false;
      }
    });

    var sum_lat = 0;
    var sum_lon = 0;
    for (var i = 0; i < eventsWithGPS.length; i++) {
      sum_lat += parseFloat(eventsWithGPS[i].gps_lat);
      sum_lon += parseFloat(eventsWithGPS[i].gps_lon);
    }
    var avg_lat = sum_lat / eventsWithGPS.length;
    var avg_lon = sum_lon / eventsWithGPS.length;

    var markers = eventsWithGPS.map(function(album) {
      return <Marker position={[album.gps_lat, album.gps_lon]} />;
    });
    return [avg_lat, avg_lon, markers];
  }

  render() {
    if (this.props.fetchedAlbumsAutoList) {
      var res = this.preprocess();
      var avg_lat = res[0];
      var avg_lon = res[1];
      var markers = res[2];

      return (
        <div>
          <Map
            ref={this.mapRef}
            center={[avg_lat, avg_lon]}
            zoom={2}
          >
            <TileLayer
              attribution="&copy; <a href=&quot;https://osm.org/copyright&quot;>OpenStreetMap</a> contributors"
              url="https://{s}.tile.osm.org/{z}/{x}/{y}.png"
            />
            {markers}
          </Map>
        </div>
      );
    } else {
      return <div />;
    }
  }
}

export class LocationClusterMap extends Component {
  state = {
    visibleMarkers: [],
    visiblePlaceAlbums: [],
    locationClusters: [],
    width: window.innerWidth,
    height: window.innerHeight,
    entrySquareSize: 200,
    gridHeight: window.innerHeight - topMenuHeight - 300,
    headerHeight: 60,
    numEntrySquaresPerRow: 3
  };

  constructor(props) {
    super(props);
    this.mapRef = React.createRef();
    this.preprocess = this.preprocess.bind(this);
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this);
  }

  componentDidMount() {
    this.calculateEntrySquareSize();

    window.addEventListener("resize", this.calculateEntrySquareSize);

    if (this.props.albumsPlaceList.length === 0) {
      this.props.dispatch(fetchPlaceAlbumsList());
    }

    if (!this.props.fetchedLocationClusters) {
      this.props.dispatch(fetchLocationClusters());
    }

    console.log("Map was just set visible.");

    var resizeDone = false

    // attempt resize 8 times; mapRef.current might be undefined
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        if (!resizeDone) {
          if (this.mapRef.current) {
            const map = this.mapRef.current.leafletElement;
            map.invalidateSize(true);
            resizeDone = true
            console.log('Map resized.')
          }
        }
      }, 1000*(i+1));
    };

  }

  onViewportChanged = viewport => {
    console.log('Viewport changed, mapping new photo location: ', viewport.center);
    this.setState({ viewport });

    const map = this.mapRef.current.leafletElement;

    // map.invalidateSize was undefined when this was called from Map div context
    if (map.invalidateSize) {
      map.invalidateSize(true);
    }

    const bounds = map.getBounds();

    const visibleMarkers = this.props.locationClusters.filter(loc => {
      const markerLat = loc[0];
      const markerLng = loc[1];
      if (
        markerLat < bounds._northEast.lat &&
        markerLat > bounds._southWest.lat &&
        markerLng < bounds._northEast.lng &&
        markerLng > bounds._southWest.lng
      ) {
        return true;
      } else {
        return false;
      }
    });

    const visiblePlaceNames = visibleMarkers.map(el => el[2]);

    const visiblePlaceAlbums = this.props.albumsPlaceList.filter(el => {
      if (visiblePlaceNames.includes(el.title)) {
        return true;
      } else {
        return false;
      }
    });

    console.log(visibleMarkers);
    this.setState({
      visibleMarkers: visibleMarkers,
      visiblePlaceAlbums: _.sortBy(visiblePlaceAlbums, [
        "geolocation_level",
        "photo_count"
      ])
    });
  };

  static getDerivedStateFromProps(nextProps, prevState) {
    if (prevState.locationClusters.length === 0) {
      const visibleMarkers = nextProps.locationClusters;
      const visiblePlaceNames = visibleMarkers.map(el => el[2]);
      const visiblePlaceAlbums = nextProps.albumsPlaceList.filter(el => {
        if (visiblePlaceNames.includes(el.title)) {
          return true;
        } else {
          return false;
        }
      });

      return {
        visibleMarkers: nextProps.locationClusters,
        locationClusters: nextProps.locationClusters,
        visiblePlaceAlbums: _.sortBy(visiblePlaceAlbums, [
          "geolocation_level",
          "photo_count"
        ])
      };
    } else {
      return { ...prevState };
    }
  }

  preprocess() {
    var markers = this.props.locationClusters.map(function(loc) {
      if (loc[0] !== 0) {
        return <Marker position={[loc[0], loc[1]]} title={loc[2]} />;
      }
    });
    return markers;
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
    var place = this.state.visiblePlaceAlbums;
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
                  label={{
                    as: "a",
                    corner: "left",
                    icon: "map marker alternate"
                  }}
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
    console.log(this.state);
    if (this.props.fetchedLocationClusters) {
      var markers = this.preprocess();

      return (
        <div>
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
                  Showing {this.state.visiblePlaceAlbums.length} places on the map
                </Header.Subheader>
              </Header.Content>
            </Header>
          </div>
          <div style={{ marginLeft: -5 }}>
            <Map
              ref={this.mapRef}
              className="markercluster-map"
              style={{
                height: 240
              }}
              onViewportChanged={this.onViewportChanged}
              center={[40, 0]}
              zoom={2}
            >
              <TileLayer
                attribution="&copy; <a href=&quot;https://osm.org/copyright&quot;>OpenStreetMap</a> contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MarkerClusterGroup>{markers}</MarkerClusterGroup>
            </Map>
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
                height={this.state.gridHeight}
                rowHeight={this.state.entrySquareSize + 60}
                rowCount={Math.ceil(
                  this.state.visiblePlaceAlbums.length /
                    this.state.numEntrySquaresPerRow.toFixed(1)
                )}
                width={width}
              />
            )}
          </AutoSizer>
        </div>
      );
    } else {
      return (
        <div style={{ height: this.props.height }}>
          <Loader active>Map loading...</Loader>
        </div>
      );
    }
  }
}

export class AllPhotosMap extends Component {
  componentDidMount() {
    this.props.dispatch(fetchPhotos());
  }

  render() {
    if (this.props.fetchedPhotos) {
      var map = <LocationMap photos={this.props.photos} />;
    } else {
      var map = <div />;
    }
    return <div>{map}</div>;
  }
}

AllPhotosMap = connect(store => {
  return {
    photos: store.photos.photos,
    fetchingPhotos: store.photos.fetchingPhotos,
    fetchedPhotos: store.photos.fetchedPhotos
  };
})(AllPhotosMap);

EventMap = connect(store => {
  return {
    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList
  };
})(EventMap);

LocationClusterMap = connect(store => {
  return {
    albumsPlaceList: store.albums.albumsPlaceList,
    locationClusters: store.util.locationClusters,
    fetchingLocationClusters: store.util.fetchingLocationClusters,
    fetchedLocationClusters: store.util.fetchedLocationClusters
  };
})(LocationClusterMap);
