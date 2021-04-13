import React, { Component } from 'react';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";
import { fetchDateAlbumsPhotoHashList } from '../actions/albumsActions'
import { PhotoListView } from './ReusablePhotoListView'

export class AllPhotosHashListViewRV extends Component {
    componentDidMount() {
        if (this.props.albumsDatePhotoHashList.length < 1) {
            this.props.dispatch(fetchDateAlbumsPhotoHashList())
        }
    }

    render() {
        const {fetchingAlbumsDatePhotoHashList} = this.props
        return (
            <PhotoListView 
                title={"Photos"}
                loading={fetchingAlbumsDatePhotoHashList}
                titleIconName={'images'}
                photosGroupedByDate={this.props.albumsDatePhotoHashList}
                idx2hash={this.props.idx2hash}
            />
        )
    }
}

AllPhotosHashListViewRV = connect((store)=>{
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
    fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(AllPhotosHashListViewRV)
