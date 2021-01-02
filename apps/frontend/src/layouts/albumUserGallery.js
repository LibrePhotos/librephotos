import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchUserAlbum } from "../actions/albumsActions";
import _ from "lodash";
import moment from "moment";
import { PhotoListView } from "./ReusablePhotoListView";


var topMenuHeight = 45; // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;

var DAY_HEADER_HEIGHT = 70;
var leftMenuWidth = 85; // don't change this

export class AlbumUserGallery extends Component {
  state = {
    photosGroupedByDate: [],
    idx2hash: [],
    albumID: null
  };

  componentDidMount() {
    this.props.dispatch(fetchUserAlbum(this.props.match.params.albumID));
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (nextProps.albumsUser.hasOwnProperty(nextProps.match.params.albumID)) {
      const photos =
        nextProps.albumsUser[nextProps.match.params.albumID].photos;
      if (prevState.idx2hash.length != photos.length) {
        var t0 = performance.now();
        var groupedByDate = _.groupBy(photos, el => {
          if (el.exif_timestamp) {
            return moment.utc(el.exif_timestamp).format("YYYY-MM-DD");
          } else {
            return "No Timestamp";
          }
        });
        var groupedByDateList = _.reverse(
          _.sortBy(
            _.toPairsIn(groupedByDate).map(el => {
              return { date: el[0], photos: el[1] };
            }),
            el => el.date
          )
        );
        var idx2hash = [];
        groupedByDateList.forEach(g => {
          g.photos.forEach(p => {
            idx2hash.push(p.image_hash);
          });
        });
        var t1 = performance.now();
        console.log(t1 - t0);
        return {
          ...prevState,
          photosGroupedByDate: groupedByDateList,
          idx2hash: idx2hash,
          albumID: nextProps.match.params.albumID
        };
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  render() {
    const { fetchingAlbumsUser } = this.props;
    console.log(this.props);
    const isPublic =
      this.props.albumsUser[this.props.match.params.albumID] &&
      this.props.albumsUser[this.props.match.params.albumID].owner.id !==
        this.props.auth.access.user_id;
    return (
      <PhotoListView
        title={
          this.props.albumsUser[this.props.match.params.albumID]
            ? this.props.albumsUser[this.props.match.params.albumID].title
            : "Loading... "
        }
        additionalSubHeader={
          this.props.albumsUser[this.props.match.params.albumID] && isPublic ? (
            <span>
              {", "}owned by{" "}
              <b style={{ color: "black" }}>
                {this.props.albumsUser[this.props.match.params.albumID].owner
                  .id === this.props.auth.access.user_id
                  ? "you"
                  : this.props.albumsUser[this.props.match.params.albumID].owner
                      .username}
              </b>
            </span>
          ) : (
            ""
          )
        }
        loading={fetchingAlbumsUser}
        titleIconName={"bookmark"}
        photosGroupedByDate={this.state.photosGroupedByDate}
        idx2hash={this.state.idx2hash}
        match={this.props.match}
        isPublic={isPublic}
      />
    );
  }
}

AlbumUserGallery = connect(store => {
  return {
    auth: store.auth,
    albumsUser: store.albums.albumsUser,
    fetchingAlbumsUser: store.albums.fetchingAlbumsUser,
    fetchedAlbumsUser: store.albums.fetchedAlbumsUser,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail
  };
})(AlbumUserGallery);
