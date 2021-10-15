import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchFavoritePhotos } from "../../actions/photosActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";

export class FavoritePhotos extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotosetType !== PhotosetType.FAVORITES) {
      this.props.dispatch(fetchFavoritePhotos());
    }
  }

  render() {
    return (
      <PhotoListView
        showHidden={false}
        title={"Favorite Photos"}
        loading={this.props.fetchedPhotosetType !== PhotosetType.FAVORITES}
        titleIconName={"star"}
        isDateView={true}
        photoset={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
      />
    );
  }
}

FavoritePhotos = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    photosGroupedByDate: store.photos.photosGroupedByDate,
    fetchedPhotosetType: store.photos.fetchedPhotosetType,
  };
})(FavoritePhotos);
