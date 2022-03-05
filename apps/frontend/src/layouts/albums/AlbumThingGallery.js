import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchThingAlbum } from "../../actions/albumsActions";
import _ from "lodash";
import moment from "moment";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { compose } from "redux";
import { withTranslation } from "react-i18next";
export class AlbumThingGallery extends Component {
  componentDidMount() {
    this.props.dispatch(fetchThingAlbum(this.props.match.params.albumID));
  }

  render() {
    const { fetchingAlbumsThing } = this.props;
    const groupedPhotos = this.props.albumsThing[this.props.match.params.albumID];
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
        loading={fetchingAlbumsThing}
        titleIconName={"tags"}
        isDateView={true}
        photoset={groupedPhotos ? groupedPhotos.grouped_photos : []}
        idx2hash={groupedPhotos ? groupedPhotos.grouped_photos.flatMap((el) => el.items) : []}
        selectable={true}
      />
    );
  }
}

AlbumThingGallery = compose(
  connect((store) => {
    return {
      albumsThing: store.albums.albumsThing,
      fetchingAlbumsThing: store.albums.fetchingAlbumsThing,
    };
  }),
  withTranslation()
)(AlbumThingGallery);
