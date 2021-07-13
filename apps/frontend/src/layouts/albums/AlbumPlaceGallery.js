import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchPlaceAlbum } from '../../actions/albumsActions'
import _ from 'lodash'
import moment from 'moment'
import { PhotoListView } from '../../components/photolist/PhotoListView'

export class AlbumPlaceGallery extends Component {
  
    componentDidMount() {
        this.props.dispatch(fetchPlaceAlbum(this.props.match.params.albumID))
    }  
  
    render() {
      const {fetchingAlbumsPlace} = this.props
      return (
        <PhotoListView 
          title={this.props.albumsPlace[this.props.match.params.albumID] ? this.props.albumsPlace[this.props.match.params.albumID].title : "Loading... "}
          loading={fetchingAlbumsPlace}
          titleIconName={'map outline'}
          isDateView={true}
          photosGroupedByDate={this.props.albumsPlace[this.props.match.params.albumID] ? this.props.albumsPlace[this.props.match.params.albumID].grouped_photos : []}
          idx2hash={this.props.albumsPlace[this.props.match.params.albumID] ? this.props.albumsPlace[this.props.match.params.albumID].grouped_photos.flatMap((el)=>el.items) : []}
        />
      )  
    }
  }


AlbumPlaceGallery = connect((store)=>{
  return {
    albumsPlace: store.albums.albumsPlace,
    fetchingAlbumsPlace: store.albums.fetchingAlbumsPlace,
    fetchedAlbumsPlace: store.albums.fetchedAlbumsPlace,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
  }
})(AlbumPlaceGallery)
