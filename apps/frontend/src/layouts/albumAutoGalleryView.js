import React, { Component } from "react";
import {
  Header,
  Divider,
  Loader,
  Dimmer,
  Breadcrumb,
  Image,
  Label,
  Button,
  Icon
} from "semantic-ui-react";
import { connect } from "react-redux";
// import {Image} from '../components/authenticatedImage'
import { Link } from "react-router-dom";
import { fetchAlbumsAutoGalleries } from "../actions/albumsActions";
import { Map, TileLayer, Marker } from "react-leaflet";
import {serverAddress } from "../api_client/apiClient";
import {fetchPhotoDetail} from "../actions/photosActions";
import * as moment from "moment";
import _ from "lodash";
import LazyLoad from "react-lazyload";
import { SecuredImageJWT } from "../components/SecuredImage";
import { LightBox } from "../components/lightBox";

var topMenuHeight = 45; // don't change this
var SIDEBAR_WIDTH = 85;

const colors = [
  "red",
  "orange",
  "yellow",
  "olive",
  "green",
  "teal",
  "blue",
  "violet",
  "purple",
  "pink",
  "brown",
  "grey",
  "black"
];

export class AlbumLocationMap extends Component {
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

    var markers = photosWithGPS.map(function(photo, idx) {
      return (
        <Marker
          key={"marker-" + photo.id + "-" + idx}
          position={[photo.exif_gps_lat, photo.exif_gps_lon]}
        />
      );
    });
    if (photosWithGPS.length > 0) {
      return (
        <div style={{ padding: 0 }}>
          <Map center={[avg_lat, avg_lon]} zoom={6}>
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

/*******************************************************************************
AUTO GENERATED EVENT ALBUM
*******************************************************************************/

export class AlbumAutoGalleryView extends Component {
  state = {
    idx2hash: [],
    lightboxImageIndex: 0,
    lightboxShow: false,
    headerHeight: 80,
    width: window.innerWidth,
    height: window.innerHeight,
    showMap: false,
    entrySquareSize: 200,
    gridHeight: window.innerHeight - topMenuHeight - 60
  };

  constructor(props) {
    super(props);
    this.onPhotoClick = this.onPhotoClick.bind(this);
  }

  componentWillMount() {    
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
    this.props.dispatch(
      fetchAlbumsAutoGalleries(this.props.match.params.albumID)
    );
  }

  calculateEntrySquareSize() {
    var numEntrySquaresPerRow = 10;
    if (window.innerWidth < 600) {
      numEntrySquaresPerRow = 2;
    } else if (window.innerWidth < 800) {
      numEntrySquaresPerRow = 4;
    } else if (window.innerWidth < 1000) {
      numEntrySquaresPerRow = 6;
    } else if (window.innerWidth < 1200) {
      numEntrySquaresPerRow = 8;
    }

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 20;

    var entrySquareSize = columnWidth / numEntrySquaresPerRow;
    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow
    });
  }


  onPhotoClick(image_hash) {
    this.setState({
      lightboxImageIndex: this.state.idx2hash.indexOf(image_hash),
      lightboxShow: true
    });
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var photoIndex = rowIndex * this.state.numEntrySquaresPerRow + columnIndex;
    if (
      photoIndex <
      this.props.albumsAutoGalleries[this.props.match.params.albumID].photos
        .length
    ) {
      var image_hash = this.props.albumsAutoGalleries[
        this.props.match.params.albumID
      ].photos[photoIndex].image_hash;
      return (
        <div key={key} style={style}>
          <div
            onClick={() => {
              this.onPhotoClick(photoIndex);
            }}
          >
            <SecuredImageJWT
              height={this.state.entrySquareSize - 5}
              width={this.state.entrySquareSize - 5}
              src={
                serverAddress +
                "/media/square_thumbnails/" +
                image_hash +
                ".jpg"
              }
            />
          </div>
        </div>
      );
    } else {
      return <div key={key} style={style} />;
    }
  };

  getPhotoDetails(image_hash) {
    if (!this.props.photoDetails.hasOwnProperty(image_hash)) {
      this.props.dispatch(fetchPhotoDetail(image_hash));
    }
  }

  render() {
    var albumID = this.props.match.params.albumID;
    if (
      this.props.albumsAutoGalleries.hasOwnProperty(albumID) &&
      !this.props.fetchingAlbumsAutoGalleries
    ) {
      var album = this.props.albumsAutoGalleries[
        this.props.match.params.albumID
      ];
      var photos = _.sortBy(album.photos, "exif_timestamp").map((el, idx) => {
        return { ...el, idx: idx };
      });
      var idx2hash = _
        .sortBy(album.photos, "exif_timestamp")
        .map((el, idx) => el.image_hash);
      var byDate = _.groupBy(
        _.sortBy(photos, "exif_timestamp"),
        photo => photo.exif_timestamp.split("T")[0]
      );
      return (
        <div>
          <div style={{ paddingTop: 10, paddingRight: 5 }}>
            <Header as="h2">
              <Icon name="wizard" />
              <Header.Content>
                {album.title}
                <Header.Subheader>
                  <Icon name="photo" /> {album.photos.length} Photos <br />
                  <Icon name="calendar outline" />{" "}
                  <b>
                    {moment(album.photos[0].exif_timestamp).format(
                      "MMMM Do YYYY"
                    )}
                  </b>{" "}
                  -
                  <b>
                    {moment(
                      album.photos[album.photos.length - 1].exif_timestamp
                    ).format(" MMMM Do YYYY")}
                  </b>
                </Header.Subheader>
              </Header.Content>
            </Header>
          </div>

          <div
            style={{
              position: "fixed",
              top: topMenuHeight + 10,
              right: 10,
              float: "right",
              zIndex: 1000
            }}
          >
            <Button
              active={this.state.showMap}
              color="blue"
              icon
              labelPosition="right"
              onClick={() => {
                this.setState({
                  showMap: !this.state.showMap
                });
              }}
              floated="right"
            >
              <Icon name="map" inverted />
              {this.state.showMap ? "Hide Maps" : "Show Maps"}
            </Button>
          </div>

          <Divider hidden />

          <div>
            {album.people.length > 0 && (
              <div>
                <Header as="h3">
                  <Icon name="users" /> People
                </Header>

                <Label.Group circular>
                  {album.people.map((person, idx) => (
                    <Label
                      key={person.id}
                      as={Link}
                      to={`/person/${person.id}`}
                      color={colors[idx % album.people.length]}
                    >
                      <SecuredImageJWT
                        avatar
                        spaced="right"
                        src={serverAddress + person.face_url}
                      />
                      <b>{person.name}</b>
                    </Label>
                  ))}
                </Label.Group>
              </div>
            )}

            <div>
              {_.toPairs(byDate).map((v, i) => {
                var locations = v[1]
                  .filter(
                    photo => (photo.geolocation_json.features ? true : false)
                  )
                  .map(photo => {
                    if (photo.geolocation_json.features) {
                      return photo.geolocation_json.features[
                        photo.geolocation_json.features.length - 3
                      ].text;
                    }
                    return "";
                  });
                return (
                  <div>
                    <Divider hidden />

                    <Header>
                      <Icon name="calendar outline" />
                      <Header.Content>
                        {`Day ${i + 1} - ` +
                          moment(v[0]).format("MMMM Do YYYY")}
                        <Header.Subheader>
                          <Breadcrumb
                            divider={<Icon name="right chevron" />}
                            sections={_.uniq(locations).map(e => {
                              return { key: e, content: e };
                            })}
                          />
                        </Header.Subheader>
                      </Header.Content>
                    </Header>

                    {locations.length > 0 &&
                      this.state.showMap && (
                        <div
                          style={{
                            margin: "auto",
                            paddingLeft: 3,
                            paddingRight: 2.5,
                            paddingTop: 10,
                            paddingBottom: 5
                          }}
                        >
                          <AlbumLocationMap photos={v[1]} />
                        </div>
                      )}

                    {v[1].map(photo => (
                      <div style={{ display: "inline-block" }}>
                        <LazyLoad
                          height={this.state.entrySquareSize}
                          placeholder={
                            <Image
                              style={{ paddingLeft: 2.5, paddingRight: 2.5 }}
                              height={this.state.entrySquareSize}
                              width={this.state.entrySquareSize}
                              src={"/thumbnail_placeholder.png"}
                            />
                          }
                        >
                          <SecuredImageJWT
                            onClick={() =>
                              this.setState({
                                lightboxImageIndex: idx2hash.indexOf(
                                  photo.image_hash
                                ),
                                lightboxShow: true
                              })
                            }
                            style={{ paddingLeft: 2.5, paddingRight: 2.5 }}
                            height={this.state.entrySquareSize}
                            width={this.state.entrySquareSize}
                            src={serverAddress + photo.square_thumbnail_url}
                          />
                        </LazyLoad>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {this.state.lightboxShow && (
            <LightBox
              idx2hash={idx2hash}
              lightboxImageIndex={this.state.lightboxImageIndex}
              onCloseRequest={() => this.setState({ lightboxShow: false })}
              onImageLoad={() => {
                this.getPhotoDetails(idx2hash[this.state.lightboxImageIndex]);
              }}
              onMovePrevRequest={() => {
                var nextIndex =
                  (this.state.lightboxImageIndex + idx2hash.length - 1) %
                  idx2hash.length;
                this.setState({
                  lightboxImageIndex: nextIndex
                });
                this.getPhotoDetails(idx2hash[nextIndex]);
              }}
              onMoveNextRequest={() => {
                var nextIndex =
                  (this.state.lightboxImageIndex + idx2hash.length + 1) %
                  idx2hash.length;
                this.setState({
                  lightboxImageIndex: nextIndex
                });
                this.getPhotoDetails(idx2hash[nextIndex]);
              }}
            />
          )}
        </div>
      );
    } else {
      return (
        <div>
          <Dimmer active>
            <Loader active />
          </Dimmer>
        </div>
      );
    }
  }
}

AlbumAutoGalleryView = connect(store => {
  return {
    fetchingAlbumsAutoGalleries: store.albums.fetchingAlbumsAutoGalleries,
    fetchedAlbumsAutoGalleries: store.albums.fetchedAlbumsAutoGalleries,
    albumsAutoGalleries: store.albums.albumsAutoGalleries,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail
  };
})(AlbumAutoGalleryView);
