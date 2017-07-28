import {scanPhotos,fetchPhotos} from '../actions/photosActions'
import React, {Component} from 'react'
import { connect } from "react-redux";
import { Map, TileLayer, Marker } from 'react-leaflet'





export class LocationMap extends Component {
  render() {
    var photosWithGPS = this.props.photos.filter(function(photo){
      if (photo.exif_gps_lon !== null && photo.exif_gps_lon){
        return true
      }
      else {
        return false
      }
    })
    
    var sum_lat = 0
    var sum_lon = 0
    for (var i=0;i<photosWithGPS.length;i++){
      sum_lat += parseFloat(photosWithGPS[i].exif_gps_lat)
      sum_lon += parseFloat(photosWithGPS[i].exif_gps_lon)
    }
    var avg_lat = sum_lat/photosWithGPS.length
    var avg_lon = sum_lon/photosWithGPS.length

    var markers = photosWithGPS.map(function(photo){
      return (
        <Marker position={[photo.exif_gps_lat, photo.exif_gps_lon]}>
        </Marker>
      )
    })
    console.log(markers)

    if (photosWithGPS.length>0){
      return (
        <div>
          <Map center={[avg_lat,avg_lon]} zoom={2}>
            <TileLayer
              attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
              url='http://{s}.tile.osm.org/{z}/{x}/{y}.png'/>
            {markers}
          </Map>
        </div>
      )
    }
    else {
      return (
        <div></div>
      )
    }
  }
}





export class AllPhotosMap extends Component {
	componentDidMount() {
		this.props.dispatch(fetchPhotos())
	}



	render(){
		if (this.props.fetchedPhotos) {
			var map = (<LocationMap photos={this.props.photos}/>)
		}
		else {
			var map = (<div></div>)
		}
		return (
			<div>
				{map}
			</div>
		)
	}
}




AllPhotosMap = connect((store)=>{
  return {
  	photos: store.photos.photos,
  	fetchingPhotos: store.photos.fetchingPhotos,
  	fetchedPhotos: store.photos.fetchedPhotos
  }
})(AllPhotosMap)


