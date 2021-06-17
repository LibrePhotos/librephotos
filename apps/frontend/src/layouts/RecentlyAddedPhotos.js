import React, { Component } from "react";

import { connect } from "react-redux";
import { fetchRecentlyAddedPhotos } from '../actions/photosActions';
import { PhotoListView } from '../components/photolist/PhotoListView'

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
                photosGroupedByDate={this.props.recentlyAddedPhotos[0] ? this.props.recentlyAddedPhotos[0].photos : []}
                idx2hash={this.props.recentlyAddedIdx2hash}
                dayHeaderPrefix={'Added on ' }
            />
        )
    }
}

RecentlyAddedPhotos = connect(store => {
  return {
    fetchingRecentlyAddedPhotos: store.photos.fetchingRecentlyAddedPhotos,
    fetchedRecentlyAddedPhotos: store.photos.fetchedRecentlyAddedPhotos,
    recentlyAddedPhotos: store.photos.recentlyAddedPhotos,
    recentlyAddedIdx2hash: store.photos.recentlyAddedIdx2hash
  };
})(RecentlyAddedPhotos);
