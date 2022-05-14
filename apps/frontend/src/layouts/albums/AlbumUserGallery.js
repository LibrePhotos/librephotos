import React, { Component } from "react";
import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import { compose } from "redux";
import { Bookmark } from "tabler-icons-react";

import { fetchUserAlbum } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";

export class AlbumUserGallery extends Component {
  isLoaded() {
    return (
      this.props.fetchedPhotosetType === PhotosetType.USER_ALBUM &&
      this.props.albumDetails.id === this.props.match.params.albumID
    );
  }

  componentDidMount() {
    if (!this.isLoaded()) {
      this.props.dispatch(fetchUserAlbum(this.props.match.params.albumID));
    }
  }

  render() {
    const isPublic =
      this.props.albumDetails.owner && this.props.albumDetails.owner.id !== this.props.auth.access.user_id;
    let additionalSubHeader = "";
    if (isPublic) {
      additionalSubHeader = (
        <span>
          {", "}owned by{" "}
          <b style={{ color: "black" }}>
            {this.props.albumDetails.owner.id === this.props.auth.access.user_id
              ? "you"
              : this.props.albumDetails.owner.username}
          </b>
        </span>
      );
    }
    return (
      <PhotoListView
        title={this.props.albumDetails ? this.props.albumDetails.title : this.props.t("loading")}
        additionalSubHeader={additionalSubHeader}
        loading={!this.isLoaded()}
        icon={<Bookmark size={50} />}
        isDateView
        photoset={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
        match={this.props.match}
        isPublic={isPublic}
        selectable
      />
    );
  }
}

AlbumUserGallery = compose(
  connect(store => ({
    auth: store.auth,
    albumDetails: store.albums.albumDetails,
    photosGroupedByDate: store.photos.photosGroupedByDate,
    photosFlat: store.photos.photosFlat,
    fetchedPhotosetType: store.photos.fetchedPhotosetType,
  })),
  withTranslation()
)(AlbumUserGallery);
