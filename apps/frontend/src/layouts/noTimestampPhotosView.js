import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchNoTimestampPhotoList } from '../actions/photosActions';
import _ from 'lodash'
import moment from 'moment'
import { PhotoListView } from './ReusablePhotoListView'

export class NoTimestampPhotosView extends Component {
    state = {
      photosGroupedByDate: [],
      idx2hash: [],
      albumID: null,
    }
  
    componentDidMount() {
        this.props.dispatch(fetchNoTimestampPhotoList())
    }

    static getDerivedStateFromProps(nextProps,prevState){
        const photos = nextProps.noTimestampPhotos.filter(photo=>photo.image_hash)
        if (prevState.idx2hash.length !== photos.length) {

            var t0 = performance.now();
            var groupedByDate = _.groupBy(photos,(el)=>{
                if (el.exif_timestamp) {
                    return moment(el.exif_timestamp).format('YYYY-MM-DD')
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
            console.log(t1-t0)
            return {
                ...prevState, 
                photosGroupedByDate: groupedByDateList,
                idx2hash:idx2hash,
                albumID:nextProps.match.params.albumID
            }
        } else {
            return null
        }

    }
  
  
  
    render() {
      const {fetchingNoTimestampPhotos} = this.props
      return (
        <PhotoListView 
          title={"Photos without Timestamps"}
          loading={fetchingNoTimestampPhotos}
          titleIconName={'images outline'}
          photosGroupedByDate={this.state.photosGroupedByDate}
          idx2hash={this.state.idx2hash}
        />
      )  
    }
  }

NoTimestampPhotosView = connect((store)=>{
  return {
  	fetchingNoTimestampPhotos: store.photos.fetchingNoTimestampPhotos,
	fetchedNoTimestampPhotos: store.photos.fetchedNoTimestampPhotos,
    noTimestampPhotos: store.photos.noTimestampPhotos,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
  }
})(NoTimestampPhotosView)


