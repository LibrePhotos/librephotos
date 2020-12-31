import React, { Component } from "react";

import { connect } from "react-redux";
import { fetchRecentlyAddedPhotos } from '../actions/photosActions';
import _ from 'lodash'
import { PhotoListView } from './ReusablePhotoListView'


var topMenuHeight = 55 // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;

var DAY_HEADER_HEIGHT = 70
var leftMenuWidth = 85 // don't change this

export class RecentlyAddedPhotos extends Component {
  componentDidMount() {
    this.props.dispatch(fetchRecentlyAddedPhotos())
  }
    render() {
        const {fetchingRecentlyAddedPhotos,fetchedRecentlyAddedPhotos} = this.props
        return (
            <PhotoListView 
                title={"Recently Added"}
                loading={fetchingRecentlyAddedPhotos}
                titleIconName={'clock'}
                photosGroupedByDate={this.props.recentlyAddedPhotos.slice(0,1)}
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
