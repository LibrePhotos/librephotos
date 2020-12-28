import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchPlaceAlbum } from '../actions/albumsActions'
import _ from 'lodash'
import moment from 'moment'
import { PhotoListView } from './ReusablePhotoListView'


const topMenuHeight = 55 // don't change this
const ESCAPE_KEY = 27;
const ENTER_KEY = 13;
const RIGHT_ARROW_KEY = 39;
const UP_ARROW_KEY = 38;
const LEFT_ARROW_KEY = 37;
const DOWN_ARROW_KEY = 40;

const SIDEBAR_WIDTH = 85;

const DAY_HEADER_HEIGHT = 70
const leftMenuWidth = 85 // don't change this




export class AlbumPlaceGallery extends Component {
    state = {
      photosGroupedByDate: [],
      idx2hash: [],
      albumID: null,
    }
  
    componentDidMount() {
        this.props.dispatch(fetchPlaceAlbum(this.props.match.params.albumID))
    }



  
  
  
    static getDerivedStateFromProps(nextProps,prevState){
        if (nextProps.albumsPlace.hasOwnProperty(nextProps.match.params.albumID)){
            const photos = nextProps.albumsPlace[nextProps.match.params.albumID].photos
            if (prevState.idx2hash.length !== photos.length) {

                var t0 = performance.now();
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
                var t1 = performance.now();
                return {
                    ...prevState, 
                    photosGroupedByDate: groupedByDateList,
                    idx2hash:idx2hash,
                    albumID:nextProps.match.params.albumID
                }
            } else {
                return null
            }
        } else {
            return null
        }
    }
  
  
  
    render() {
      const {fetchingAlbumsPlace} = this.props
      return (
        <PhotoListView 
          title={this.props.albumsPlace[this.props.match.params.albumID] ? this.props.albumsPlace[this.props.match.params.albumID].title : "Loading... "}
          loading={fetchingAlbumsPlace}
          titleIconName={'map outline'}
          photosGroupedByDate={this.state.photosGroupedByDate}
          idx2hash={this.state.idx2hash}
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
