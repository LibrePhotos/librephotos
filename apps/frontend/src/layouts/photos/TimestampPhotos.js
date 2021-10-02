import React, { Component } from "react";
import { connect } from "react-redux";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { fetchTimestampPhotos } from "../../actions/photosActions";
import {
  fetchDateAlbumsList,
  fetchAlbumsDateGalleries,
} from "../../actions/albumsActions";
import { Photoset } from "../../reducers/photosReducer";
import throttle from "lodash";
export class TimestampPhotos extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotoset !== Photoset.TIMESTAMP) {
      this.props.dispatch(fetchDateAlbumsList());
    }
  }

  getAlbums = (visibleGroups) => {
    visibleGroups.forEach((group) => {
      if (group.incomplete === true) {
        this.props.dispatch(fetchAlbumsDateGalleries(group.id));
      }
    });
    console.log(visibleGroups);
  };

  render() {
    return (
      <PhotoListView
        title={"Photos"}
        loading={this.props.fetchedPhotoset !== Photoset.TIMESTAMP}
        titleIconName={"images"}
        isDateView={true}
        photosGroupedByDate={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
        updateGroups={(visibleGroups) =>
          throttle(this.getAlbums(visibleGroups), 500)
        }
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
