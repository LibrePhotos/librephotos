import React, { Component } from 'react';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";
import { PhotoListView } from '../components/photolist/PhotoListView'
export class SearchView extends Component {
    render() {
        console.log(this.props.searchPhotosResGroupedByDate)
        const {searchingPhotos,searchQuery} = this.props
        return (
            <PhotoListView 
                title={searchingPhotos ? `Searching "${searchQuery}"...` : searchQuery===null ? "Search for things, places, people, and time." : `"${searchQuery}"`}
                loading={searchingPhotos}
                titleIconName={'search'}
                isDateView={true}
                photosGroupedByDate={this.props.searchPhotosResGroupedByDate[0] ? this.props.searchPhotosResGroupedByDate : []}
                idx2hash={[]}
            />
        )
    }
}

SearchView = connect((store)=>{
  return {
    searchingPhotos: store.search.searchingPhotos,
    searchedPhotos: store.search.searchedPhotos,
    searchPhotosRes: store.search.searchPhotosRes,
    searchPhotosResGroupedByDate: store.search.searchPhotosResGroupedByDate,
    searchQuery: store.search.query,

    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
    idx2hash: store.search.idx2hash,
    albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(SearchView)