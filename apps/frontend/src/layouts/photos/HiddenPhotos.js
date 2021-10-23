import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchHiddenPhotos } from "../../actions/photosActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";

export class HiddenPhotos extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotosetType !== PhotosetType.HIDDEN) {
      this.props.dispatch(fetchHiddenPhotos());
    }
  }

  render() {
    return (
      <PhotoListView
        showHidden={true}
        title={"Hidden Photos"}
        loading={this.props.fetchedPhotosetType !== PhotosetType.HIDDEN}
        titleIconName={"hide"}
        isDateView={true}
        photoset={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
      />
    );
  }
}

HiddenPhotos = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    photosGroupedByDate: store.photos.photosGroupedByDate,
    fetchedPhotosetType: store.photos.fetchedPhotosetType,
  };
})(HiddenPhotos);
