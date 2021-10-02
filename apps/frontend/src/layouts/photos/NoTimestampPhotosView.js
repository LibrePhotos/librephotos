import React, { Component } from "react";
import { connect } from "react-redux";
import {
  fetchNoTimestampPhotoPaginated,
  fetchNoTimestampPhotoCount,
} from "../../actions/photosActions";
import throttle from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { Photoset } from "../../reducers/photosReducer";

export class NoTimestampPhotosView extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotoset !== Photoset.NO_TIMESTAMP) {
      this.props.dispatch(fetchNoTimestampPhotoCount());
      this.props.dispatch(fetchNoTimestampPhotoPaginated(1));
    }
  }

  getImages = (visibleItems) => {
    if (
      visibleItems.filter((i) => i.isTemp && i.isTemp != undefined).length > 0
    ) {
      var firstTempObject = visibleItems.filter((i) => i.isTemp)[0];
      if (Math.ceil((firstTempObject.id + 1) / 100) != 0) {
        this.props.dispatch(
          fetchNoTimestampPhotoPaginated(
            Math.ceil((firstTempObject.id + 1) / 100)
          )
        );
      }
    }
  };

  render() {
    return (
      <PhotoListView
        title={"Photos without Timestamps"}
        loading={this.props.fetchedPhotoset !== Photoset.NO_TIMESTAMP}
        titleIconName={"images outline"}
        isDateView={false}
        photosGroupedByDate={this.props.photosFlat}
        idx2hash={this.props.photosFlat}
        numberOfItems={this.props.numberOfPhotos}
        updateItems={(visibleItems) => {
          console.log(visibleItems);
          throttle(this.getImages(visibleItems), 500);
        }}
      />
    );
  }
}

NoTimestampPhotosView = connect((store) => {
  return {
    numberOfPhotos: store.photos.numberOfPhotos,
    photosFlat: store.photos.photosFlat,
    fetchedPhotoset: store.photos.fetchedPhotoset,
  };
})(NoTimestampPhotosView);
