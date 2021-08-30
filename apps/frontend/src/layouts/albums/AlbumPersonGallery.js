import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchPersonPhotos } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { Photoset } from "../../reducers/photosReducer";

export class AlbumPersonGallery extends Component {
  isLoaded() {
    return (
      this.props.fetchedPhotoset === Photoset.PERSON &&
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
        photosGroupedByDate={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
      />
    );
  }
}

AlbumPersonGallery = connect((store) => {
  return {
    photosGroupedByDate: store.photos.photosGroupedByDate,
    photosFlat: store.photos.photosFlat,
    personDetails: store.albums.personDetails,
    fetchedPhotoset: store.photos.fetchedPhotoset,
  };
})(AlbumPersonGallery);
