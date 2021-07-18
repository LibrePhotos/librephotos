import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchNoTimestampPhotoList } from '../../actions/photosActions';
import _ from 'lodash'
import { PhotoListView } from  '../../components/photolist/PhotoListView'

export class NoTimestampPhotosView extends Component {
  
    componentDidMount() {
        this.props.dispatch(fetchNoTimestampPhotoList())
    }

    render() {
      const {fetchingNoTimestampPhotos} = this.props
      return (
        <PhotoListView 
          title={"Photos without Timestamps"}
          loading={fetchingNoTimestampPhotos}
          titleIconName={'images outline'}
          isDateView={false}
          photosGroupedByDate={this.props.noTimestampPhotos ? this.props.noTimestampPhotos : []}
          idx2hash={this.props.noTimestampPhotos ? this.props.noTimestampPhotos : []}
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


