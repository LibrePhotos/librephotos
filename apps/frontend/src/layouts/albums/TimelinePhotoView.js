import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchDateAlbumsPhotoHashList } from "../../actions/albumsActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import * as moment from "moment";

export class TimelinePhotoView extends Component {

  componentDidMount() {
    if (this.props.albumsDatePhotoHashList.length < 1) {
      this.props.dispatch(fetchDateAlbumsPhotoHashList());
    }
  }

  render() {
    // This will get changed every time it is called...
    const { fetchingAlbumsDatePhotoHashList } = this.props;
    const changedStuff = this.props.albumsDatePhotoHashList;
    changedStuff.forEach(
      (group) => (group.date = moment(group.date).format("MMM Do YYYY, dddd") !== "Invalid date" ?  moment(group.date).format("MMM Do YYYY, dddd") : group.date)
    );
    return (
      <PhotoListView
        title={"Photos"}
        loading={fetchingAlbumsDatePhotoHashList}
        titleIconName={"images"}
        isDateView={true}
        photosGroupedByDate={changedStuff}
        idx2hash={this.props.albumsDatePhotoHashList.flatMap((el) => el.items)}
      />
    );
  }
}

TimelinePhotoView = connect((store) => {
  return {
    showSidebar: store.ui.showSidebar,

    photos: store.photos.photos,
    fetchingPhotos: store.photos.fetchingPhotos,
    fetchedPhotos: store.photos.fetchedPhotos,

    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,

    idx2hash: store.albums.idx2hash,

    albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    fetchingAlbumsDatePhotoHashList:
      store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,
  };
})(TimelinePhotoView);
