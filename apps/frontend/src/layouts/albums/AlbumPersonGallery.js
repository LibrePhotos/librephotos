import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchPersonPhotos } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";

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
            : "Loading... "
        }
        loading={!this.isLoaded()}
        titleIconName={"user"}
        isDateView={true}
        photoset={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
        selectable={true}
      />
    );
  }
}

AlbumPersonGallery = connect((store) => {
  return {
    photosGroupedByDate: store.photos.photosGroupedByDate,
    photosFlat: store.photos.photosFlat,
    personDetails: store.albums.personDetails,
    fetchedPhotosetType: store.photos.fetchedPhotosetType,
  };
})(AlbumPersonGallery);
