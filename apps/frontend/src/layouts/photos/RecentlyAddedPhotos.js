import React, { Component } from "react";
import moment from "moment";
import { connect } from "react-redux";
import { fetchRecentlyAddedPhotos } from "../../actions/photosActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { Photoset } from "../../reducers/photosReducer";

export class RecentlyAddedPhotos extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotoset !== Photoset.RECENTLY_ADDED) {
      this.props.dispatch(fetchRecentlyAddedPhotos());
    }
  }
  render() {
    return (
      <PhotoListView
        title={"Recently Added"}
        loading={this.props.fetchedPhotoset !== Photoset.RECENTLY_ADDED}
        titleIconName={"clock"}
        isDateView={false}
        date={
          moment(this.props.recentlyAddedPhotosDate).format(
            "MMM Do YYYY, dddd"
          ) !== "Invalid date"
            ? moment(this.props.recentlyAddedPhotosDate).format(
                "MMM Do YYYY, dddd"
              )
            : this.props.recentlyAddedPhotosDate
        }
        photosGroupedByDate={this.props.photosFlat}
        idx2hash={this.props.photosFlat}
        dayHeaderPrefix={"Added on "}
      />
    );
  }
}

RecentlyAddedPhotos = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    recentlyAddedPhotosDate: store.photos.RecentlyAddedPhotosDate,
    fetchedPhotoset: store.photos.fetchedPhotoset,
  };
})(RecentlyAddedPhotos);
