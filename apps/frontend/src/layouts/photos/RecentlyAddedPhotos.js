import React, { Component } from "react";
import * as moment from "moment";
import { connect } from "react-redux";
import { fetchRecentlyAddedPhotos } from '../../actions/photosActions';
import { PhotoListView } from '../../components/photolist/PhotoListView'

export class RecentlyAddedPhotos extends Component {
  componentDidMount() {
    this.props.dispatch(fetchRecentlyAddedPhotos())
  }
    render() {
        const {fetchingRecentlyAddedPhotos} = this.props
        return (
            <PhotoListView 
                title={"Recently Added"}
                loading={fetchingRecentlyAddedPhotos}
                titleIconName={'clock'}
                isDateView={false}
                date={moment(this.props.recentlyAddedPhotos.date).format("MMM Do YYYY, dddd") !== "Invalid date" ?  moment(this.props.recentlyAddedPhotos.date).format("MMM Do YYYY, dddd") : this.props.recentlyAddedPhotos.date}
                photosGroupedByDate={this.props.recentlyAddedPhotos.photos}
                idx2hash={this.props.recentlyAddedPhotos.photos}
                dayHeaderPrefix={'Added on ' }
            />
        )
    }
}

RecentlyAddedPhotos = connect(store => {
  return {
    fetchingRecentlyAddedPhotos: store.photos.fetchingRecentlyAddedPhotos,
    fetchedRecentlyAddedPhotos: store.photos.fetchedRecentlyAddedPhotos,
    recentlyAddedPhotos: store.photos.recentlyAddedPhotos
  };
})(RecentlyAddedPhotos);
