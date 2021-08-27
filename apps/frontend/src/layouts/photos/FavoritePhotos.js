import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchFavoritePhotos } from "../../actions/photosActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { Photoset } from "../../reducers/photosReducer";

export class FavoritePhotos extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotoset !== Photoset.FAVORITES) {
      this.props.dispatch(fetchFavoritePhotos());
    }
  }

  render() {
    return (
      <PhotoListView
        showHidden={false}
        title={"Favorite Photos"}
        loading={this.props.fetchedPhotoset !== Photoset.FAVORITES}
        titleIconName={"star"}
        isDateView={true}
        photosGroupedByDate={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
      />
    );
  }
}

FavoritePhotos = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    photosGroupedByDate: store.photos.photosGroupedByDate,
    fetchedPhotoset: store.photos.fetchedPhotoset,
  };
})(FavoritePhotos);
