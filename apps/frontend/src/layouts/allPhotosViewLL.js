import React, { Component } from 'react'
import { connect } from "react-redux";
import { fetchPhotos } from '../actions/photosActions'


export class AllPhotosViewLL extends Component {
  constructor(props){
    super(props)
    this.groupPhotosByDate = this.groupPhotosByDate.bind(this)
  }

  componentWillMount() {
    this.props.dispatch(fetchPhotos())
  }

  groupPhotosByDate() {
    var dates = []
    this.props.photos.map(function(photo){
      if (photo.exif_timestamp != null) {
        dates.push(photo.exif_timestamp.split('T')[0])
      }
    })
    dates = new Set(dates)
    dates = Array.from(dates)
    dates.push('undated')
    console.log(dates)

    var photosGroupedByDate = {}
    
    dates.map(function(date){
      photosGroupedByDate[date] = []
    })

    this.props.photos.map(function(photo){
      if (photo.exif_timestamp != null){
        var d = photo.exif_timestamp.split('T')[0]
        photosGroupedByDate[d].push(photo)
      }
      else {
        photosGroupedByDate['undated'].push(photo)
      }
    })
    console.log(photosGroupedByDate)
  }

  render() {
    if (this.props.fetchedPhotos) {
      this.groupPhotosByDate()
    }
    return (
      <div>hello</div>
    )
  }
}

AllPhotosViewLL = connect((store)=>{
  return {
    fetchedPhotos: store.photos.fetchedPhotos,
    fetchingPhotosfetchedPhotos: store.photos.fetchingPhotos,
    photos: store.photos.photos,
  }
})(AllPhotosViewLL)

