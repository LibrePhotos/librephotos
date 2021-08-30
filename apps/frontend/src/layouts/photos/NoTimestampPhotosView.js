import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchNoTimestampPhotoList } from "../../actions/photosActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { Photoset } from "../../reducers/photosReducer";

export class NoTimestampPhotosView extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotoset !== Photoset.NO_TIMESTAMP) {
      this.props.dispatch(fetchNoTimestampPhotoList());
    }
  }

  render() {
    return (
      <PhotoListView
        title={"Photos without Timestamps"}
        loading={this.props.fetchedPhotoset !== Photoset.NO_TIMESTAMP}
        titleIconName={"images outline"}
        isDateView={false}
        photosGroupedByDate={this.props.photosFlat}
        idx2hash={this.props.photosFlat}
      />
    );
  }
}

NoTimestampPhotosView = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    fetchedPhotoset: store.photos.fetchedPhotoset,
  };
})(NoTimestampPhotosView);
