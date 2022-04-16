import _ from "lodash";
import React, { Component } from "react";
import { Map, Marker, Popup, TileLayer } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-markercluster";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";
import { Flag, Header, Icon, Image, Loader, Segment } from "semantic-ui-react";

import { fetchAutoAlbumsList, fetchPlaceAlbumsList } from "../actions/albumsActions";
import { fetchPhotos } from "../actions/photosActions";
import { fetchLocationClusters } from "../actions/utilActions";
import { serverAddress } from "../api_client/apiClient";
import { countryNames } from "../util/countryNames";
import { SecuredImageJWT } from "./SecuredImage";

export class LocationMap extends Component {
  constructor(props) {
    super(props);
    this.mapRef = React.createRef();
  }

  componentDidMount() {
    let resizeDone = false;

    // attempt resize 8 times; mapRef.current might be undefined
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        if (!resizeDone) {
          if (this.mapRef.current) {
            const map = this.mapRef.current.leafletElement;
            map.invalidateSize(true);
            resizeDone = true;
          }
        }
      }, 1000 * (i + 1));
    }
  }

  onViewportChanged = viewport => {
    console.log("Viewport changed, mapping new photo location: ", viewport.center);
    this.setState({ viewport });

    const map = this.mapRef.current.leafletElement;
    map.invalidateSize(true);
  };

  render() {
    const photosWithGPS = this.props.photos.filter(photo => {
      if (photo.exif_gps_lon !== null && photo.exif_gps_lon) {
        return true;
      }
      return false;
    });

    let sum_lat = 0;
    let sum_lon = 0;
    for (let i = 0; i < photosWithGPS.length; i++) {
      sum_lat += parseFloat(photosWithGPS[i].exif_gps_lat);
      sum_lon += parseFloat(photosWithGPS[i].exif_gps_lon);
    }
    const avg_lat = sum_lat / photosWithGPS.length;
    const avg_lon = sum_lon / photosWithGPS.length;

    const markers = photosWithGPS.map(photo => (
      <Marker key={photo.image_hash} position={[photo.exif_gps_lat, photo.exif_gps_lon]}>
        <Popup>
          <div>
            <Image src={photo.square_thumbnail} />
          </div>
        </Popup>
      </Marker>
    ));

    console.log(markers);

    if (photosWithGPS.length > 0) {
      let zoom = 2;
      if (this.props.zoom) {
        zoom = this.props.zoom;
      }
      return (
        <Segment style={{ zIndex: 2, height: this.props.height, padding: 0 }}>
          <Map ref={this.mapRef} style={{ height: this.props.height }} center={[avg_lat, avg_lon]} zoom={zoom}>
            <TileLayer
              attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.osm.org/{z}/{x}/{y}.png"
            />
            {markers}
          </Map>
        </Segment>
      );
    }
    return (
      <Segment style={{ height: this.props.height }}>
        <Loader active>Map loading...</Loader>
      </Segment>
    );
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

    let resizeDone = false;

    // attempt resize 8 times; mapRef.current might be undefined
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        if (!resizeDone) {
          if (this.mapRef.current) {
            const map = this.mapRef.current.leafletElement;
            map.invalidateSize(true);
            resizeDone = true;
            console.log("Map resized.");
          }
        }
      }, 1000 * (i + 1));
    }
  }

  onViewportChanged = viewport => {
    console.log("Viewport changed, mapping new photo location: ", viewport.center);
    this.setState({ viewport });

    const map = this.mapRef.current.leafletElement;
    map.invalidateSize(true);
  };

  preprocess() {
    const eventsWithGPS = this.props.albumsAutoList.filter(album => {
      if (album.gps_lat != null && album.gps_lon != null) {
        return true;
      }
      return false;
    });

    let sum_lat = 0;
    let sum_lon = 0;
    for (let i = 0; i < eventsWithGPS.length; i++) {
      sum_lat += parseFloat(eventsWithGPS[i].gps_lat);
      sum_lon += parseFloat(eventsWithGPS[i].gps_lon);
    }
    const avg_lat = sum_lat / eventsWithGPS.length;
    const avg_lon = sum_lon / eventsWithGPS.length;

    const markers = eventsWithGPS.map(album => <Marker position={[album.gps_lat, album.gps_lon]} />);
    return [avg_lat, avg_lon, markers];
  }

  render() {
    if (this.props.fetchedAlbumsAutoList) {
      const res = this.preprocess();
      const avg_lat = res[0];
      const avg_lon = res[1];
      const markers = res[2];

      return (
        <div>
          <Map ref={this.mapRef} center={[avg_lat, avg_lon]} zoom={2}>
            <TileLayer
              attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.osm.org/{z}/{x}/{y}.png"
            />
            {markers}
          </Map>
        </div>
      );
    }
    return <div />;
  }
}

EventMap = connect(store => ({
  albumsAutoList: store.albums.albumsAutoList,
  fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
  fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,
}))(EventMap);
