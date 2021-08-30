import React, { Component } from "react";
import { connect } from "react-redux";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { fetchTimestampPhotos } from "../../actions/photosActions";
import { Photoset } from "../../reducers/photosReducer";

export class TimestampPhotos extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotoset !== Photoset.TIMESTAMP) {
      this.props.dispatch(fetchTimestampPhotos());
    }
  }

  render() {
    return (
      <PhotoListView
        title={"Photos"}
        loading={this.props.fetchedPhotoset !== Photoset.TIMESTAMP}
        titleIconName={"images"}
        isDateView={true}
        photosGroupedByDate={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
      />
    );
  }
}

TimestampPhotos = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    photosGroupedByDate: store.photos.photosGroupedByDate,
    fetchedPhotoset: store.photos.fetchedPhotoset,
  };
})(TimestampPhotos);
