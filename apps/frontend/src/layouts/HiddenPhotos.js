import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchHiddenPhotos } from '../actions/photosActions';
import moment from 'moment'
import _ from 'lodash'
import { PhotoListView } from '../components/photolist/PhotoListView'
export class HiddenPhotos extends Component {
  state = {
    photosGroupedByDate: [],
    idx2hash: [],
  }

  componentDidMount() {
    this.props.dispatch(fetchHiddenPhotos())
  }

  render() {
    const {fetchingHiddenPhotos} = this.props
    return (
      <PhotoListView 
        showHidden={true}
        title={"Hidden Photos"}
        loading={fetchingHiddenPhotos}
        titleIconName={'hide'}
        isDateView={true}
        photosGroupedByDate={this.props.hiddenPhotos}
        idx2hash={this.state.idx2hash}
      />
    )  
  }
}

HiddenPhotos = connect((store)=>{
  return {
    favoritePhotos: store.photos.favoritePhotos,
    fetchingFavoritePhotos: store.photos.fetchingFavoritePhotos,
    fetchedFavoritePhotos: store.photos.fetchedFavoritePhotos,

    hiddenPhotos: store.photos.hiddenPhotos,
    fetchingHiddenPhotos: store.photos.fetchingHiddenPhotos,
    fetchedHiddenPhotos: store.photos.fetchedHiddenPhotos,

    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
    people: store.people.people,
    fetchedPeople: store.people.fetched,
    fetchingPeople: store.people.fetching,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
  }
})(HiddenPhotos)
