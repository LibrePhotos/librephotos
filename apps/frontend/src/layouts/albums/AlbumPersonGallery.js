import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchPeopleAlbums } from "../../actions/albumsActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import moment from "moment";
export class AlbumPersonGallery extends Component {
  componentDidMount() {
    this.props.dispatch(fetchPeopleAlbums(this.props.match.params.albumID));
  }

  render() {
    const { fetchingAlbumsPeople, fetchingPeople, albumsPeople } = this.props;
    const groupedPhotos = albumsPeople[this.props.match.params.albumID];
    if (groupedPhotos) {
      groupedPhotos.grouped_photos.forEach(
        (group) =>
          (group.date =
            moment(group.date).format("MMM Do YYYY, dddd") !== "Invalid date"
              ? moment(group.date).format("MMM Do YYYY, dddd")
              : group.date)
      );
    }
    return (
      <PhotoListView
        title={groupedPhotos ? groupedPhotos.name : "Loading... "}
        loading={fetchingAlbumsPeople || fetchingPeople}
        titleIconName={"user"}
        isDateView={true}
        photosGroupedByDate={groupedPhotos ? groupedPhotos.grouped_photos : []}
        idx2hash={
          groupedPhotos
            ? groupedPhotos.grouped_photos.flatMap((el) => el.items)
            : []
        }
      />
    );
  }
}

AlbumPersonGallery = connect((store) => {
  return {
    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
    people: store.people.people,
    fetchedPeople: store.people.fetched,
    fetchingPeople: store.people.fetching,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
  };
})(AlbumPersonGallery);
