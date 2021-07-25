import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchUserAlbum } from "../../actions/albumsActions";
import _ from "lodash";
import moment from "moment";
import { PhotoListView } from "../../components/photolist/PhotoListView";

export class AlbumUserGallery extends Component {
  state = {
    photosGroupedByDate: [],
    idx2hash: [],
    albumID: null,
  };

  componentDidMount() {
    this.props.dispatch(fetchUserAlbum(this.props.match.params.albumID));
  }

  render() {
    const { fetchingAlbumsUser } = this.props;
    console.log(this.props);
    const isPublic =
      this.props.albumsUser[this.props.match.params.albumID] &&
      this.props.albumsUser[this.props.match.params.albumID].owner.id !==
        this.props.auth.access.user_id;
    const groupedPhotos =
      this.props.albumsUser[this.props.match.params.albumID];
    if (groupedPhotos) {
      groupedPhotos.grouped_photos.forEach(
        (group) =>
          (group.date =
            moment(group.date).format("MMM Do YYYY, dddd") !== "Invalid date"
              ? moment(group.date).format("MMM Do YYYY, dddd")
              : group.date)
      );
    }
    return (
      <PhotoListView
        title={groupedPhotos ? groupedPhotos.title : "Loading... "}
        additionalSubHeader={
          groupedPhotos && isPublic ? (
            <span>
              {", "}owned by{" "}
              <b style={{ color: "black" }}>
                {groupedPhotos.owner.id === this.props.auth.access.user_id
                  ? "you"
                  : groupedPhotos.owner.username}
              </b>
            </span>
          ) : (
            ""
          )
        }
        loading={fetchingAlbumsUser}
        titleIconName={"bookmark"}
        isDateView={true}
        photosGroupedByDate={groupedPhotos ? groupedPhotos.grouped_photos : []}
        idx2hash={
          groupedPhotos
            ? groupedPhotos.grouped_photos.flatMap((el) => el.items)
            : []
        }
        match={this.props.match}
        isPublic={isPublic}
      />
    );
  }
}

AlbumUserGallery = connect((store) => {
  return {
    auth: store.auth,
    albumsUser: store.albums.albumsUser,
    fetchingAlbumsUser: store.albums.fetchingAlbumsUser,
    fetchedAlbumsUser: store.albums.fetchedAlbumsUser,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
  };
})(AlbumUserGallery);
