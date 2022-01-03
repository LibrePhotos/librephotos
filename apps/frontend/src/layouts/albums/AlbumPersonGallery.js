import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchPersonPhotos } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";
import { compose } from "redux";
import { withTranslation, Trans } from "react-i18next";
export class AlbumPersonGallery extends Component {
  isLoaded() {
    return (
      this.props.fetchedPhotosetType === PhotosetType.PERSON &&
      this.props.personDetails.id === this.props.match.params.albumID
    );
  }

  componentDidMount() {
    if (!this.isLoaded()) {
      this.props.dispatch(fetchPersonPhotos(this.props.match.params.albumID));
    }
  }

  render() {
    return (
      <PhotoListView
        title={
          this.props.personDetails.name
            ? this.props.personDetails.name
            : this.props.t("loading")
        }
        loading={!this.isLoaded()}
        titleIconName={"user"}
        isDateView={true}
        match={this.props.match}
        photoset={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
        selectable={true}
      />
    );
  }
}

AlbumPersonGallery = compose(
  connect((store) => {
    return {
      photosGroupedByDate: store.photos.photosGroupedByDate,
      photosFlat: store.photos.photosFlat,
      personDetails: store.albums.personDetails,
      fetchedPhotosetType: store.photos.fetchedPhotosetType,
    };
  }),
  withTranslation()
)(AlbumPersonGallery);
