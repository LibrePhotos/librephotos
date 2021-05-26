import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchPeopleAlbums } from '../actions/albumsActions'
import moment from 'moment'
import _ from 'lodash'
import { PhotoListView } from './ReusablePhotoListView'
export class AlbumPersonGallery extends Component {
  state = {
    photosGroupedByDate: [],
    idx2hash: [],
  }

  componentDidMount() {
      this.props.dispatch(fetchPeopleAlbums(this.props.match.params.albumID))
  }

  static getDerivedStateFromProps(nextProps,prevState){
    if (nextProps.albumsPeople.hasOwnProperty(nextProps.match.params.albumID)){
      const photos = nextProps.albumsPeople[nextProps.match.params.albumID].photos
      if (prevState.idx2hash.length !== photos.length) {
          var groupedByDate = _.groupBy(photos,(el)=>{
              if (el.exif_timestamp) {
                  return moment.utc(el.exif_timestamp).format('YYYY-MM-DD')
              } else {
                  return "No Timestamp"
              }
          })
          var groupedByDateList = _.reverse(_.sortBy(_.toPairsIn(groupedByDate).map((el)=>{
              return {date:el[0],photos:el[1]}
          }),(el)=>el.date))

          var idx2hash = []
          groupedByDateList.forEach((g)=>{
              g.photos.forEach((p)=>{
                  idx2hash.push(p.image_hash)
              })
          })
          return {
              ...prevState, 
              photosGroupedByDate: groupedByDateList,
              idx2hash:idx2hash,
          }
      } else {
        return null
      }
    } else {
      return null
    }
  }



  render() {
    const {fetchingAlbumsPeople,fetchingPeople} = this.props
    return (
      <PhotoListView 
        title={this.props.albumsPeople[this.props.match.params.albumID] ? this.props.albumsPeople[this.props.match.params.albumID].name : "Loading... "}
        loading={fetchingAlbumsPeople || fetchingPeople}
        titleIconName={'user'}
        photosGroupedByDate={this.state.photosGroupedByDate}
        idx2hash={this.state.idx2hash}
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
