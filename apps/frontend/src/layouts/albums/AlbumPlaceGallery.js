import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchPlaceAlbum } from "../../actions/albumsActions";
import _ from "lodash";
import moment from "moment";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { compose } from "redux";
import { withTranslation } from "react-i18next";

export class AlbumPlaceGallery extends Component {
  componentDidMount() {
    this.props.dispatch(fetchPlaceAlbum(this.props.match.params.albumID));
  }

  render() {
    const { fetchingAlbumsPlace } = this.props;
    const groupedPhotos =
      this.props.albumsPlace[this.props.match.params.albumID];
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
        title={groupedPhotos ? groupedPhotos.title : this.props.t("loading")}
        loading={fetchingAlbumsPlace}
        titleIconName={"map outline"}
        isDateView={true}
        photoset={groupedPhotos ? groupedPhotos.grouped_photos : []}
        idx2hash={
          groupedPhotos
            ? groupedPhotos.grouped_photos.flatMap((el) => el.items)
            : []
        }
        selectable={true}
      />
    );
  }
}

AlbumPlaceGallery = compose(
  connect((store) => {
    return {
      albumsPlace: store.albums.albumsPlace,
      fetchingAlbumsPlace: store.albums.fetchingAlbumsPlace,
    };
  }),
  withTranslation()
)(AlbumPlaceGallery);
