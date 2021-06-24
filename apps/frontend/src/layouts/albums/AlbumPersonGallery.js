import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchPeopleAlbums } from '../../actions/albumsActions'
import _ from 'lodash'
import { PhotoListView } from '../../components/photolist/PhotoListView'
export class AlbumPersonGallery extends Component {

  componentDidMount() {
      this.props.dispatch(fetchPeopleAlbums(this.props.match.params.albumID))
  }

  render() {
    const {fetchingAlbumsPeople, fetchingPeople, albumsPeople} = this.props
    console.log(albumsPeople[this.props.match.params.albumID])
    return (
      <PhotoListView 
        title={albumsPeople[this.props.match.params.albumID] ? albumsPeople[this.props.match.params.albumID].name : "Loading... "}
        loading={fetchingAlbumsPeople || fetchingPeople}
        titleIconName={'user'}
        isDateView={true}
        photosGroupedByDate={albumsPeople[this.props.match.params.albumID] ? albumsPeople[this.props.match.params.albumID].grouped_photos : []}
        idx2hash={[]}
      />
    )  
  }
}

AlbumPersonGallery = connect((store)=>{
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
  }
})(AlbumPersonGallery)
