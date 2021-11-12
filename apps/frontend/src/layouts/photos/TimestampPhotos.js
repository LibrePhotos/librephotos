import React, { Component } from "react";
import { connect } from "react-redux";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import {
  fetchDateAlbumsList,
  fetchAlbumsDateGalleries,
} from "../../actions/albumsActions";
import { PhotosetType } from "../../reducers/photosReducer";
import throttle from "lodash";
export class TimestampPhotos extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotosetType !== PhotosetType.TIMESTAMP) {
      this.props.dispatch(fetchDateAlbumsList());
    }
  }

  getAlbums = (visibleGroups) => {
    visibleGroups.forEach((group) => {
      if (group.incomplete === true) {
        this.props.dispatch(fetchAlbumsDateGalleries(group.id));
      }
    });
  };

  render() {
    return (
      <PhotoListView
        title={"Photos"}
        loading={this.props.fetchedPhotosetType !== PhotosetType.TIMESTAMP}
        titleIconName={"images"}
        isDateView={true}
        photoset={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
        updateGroups={(visibleGroups) =>
          throttle(this.getAlbums(visibleGroups), 500)
        }
        selectable={true}
      />
    );
  }
}

TimestampPhotos = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    photosGroupedByDate: store.photos.photosGroupedByDate,
    fetchedPhotosetType: store.photos.fetchedPhotosetType,
  };
})(TimestampPhotos);
