import React, {Component} from 'react'
import { connect } from "react-redux";
import {Loader ,Segment} from 'semantic-ui-react'
import { Map, TileLayer, Marker } from 'react-leaflet'
import { scanPhotos,fetchPhotos} from '../actions/photosActions'
import { fetchAutoAlbumsList } from '../actions/albumsActions'
import { fetchLocationClusters } from '../actions/utilActions'




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
        <Marker key={photo.image_hash} position={[photo.exif_gps_lat, photo.exif_gps_lon]}>
        </Marker>
      )
    })
    console.log(markers)

    if (photosWithGPS.length>0){
      if (this.props.zoom) {
        var zoom = this.props.zoom
      }
      else {
        var zoom = 2
      }
      return (
        <div style={{zIndex:2}}>
          <Map center={[avg_lat,avg_lon]} zoom={zoom}>
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
        <div>No location information</div>
      )
    }
  }
}


export class EventMap extends Component {
  constructor(props) {
    super(props)
    this.preprocess = this.preprocess.bind(this)

  }

  componentDidMount() {
    this.props.dispatch(fetchAutoAlbumsList())
  }


  preprocess() {
    var eventsWithGPS = this.props.albumsAutoList.filter(function(album){
      if (album.gps_lat != null && album.gps_lon != null){
        return true
      }
      else {
        return false
      }
    })

    var sum_lat = 0
    var sum_lon = 0
    for (var i=0;i<eventsWithGPS.length;i++){
      sum_lat += parseFloat(eventsWithGPS[i].gps_lat)
      sum_lon += parseFloat(eventsWithGPS[i].gps_lon)
    }
    var avg_lat = sum_lat/eventsWithGPS.length
    var avg_lon = sum_lon/eventsWithGPS.length

    var markers = eventsWithGPS.map(function(album){
      return (
        <Marker position={[album.gps_lat, album.gps_lon]}>
        </Marker>
      )
    })
    return [avg_lat, avg_lon, markers]
  }


  render() {
    if (this.props.fetchedAlbumsAutoList) {
      var res = this.preprocess()
      var avg_lat = res[0]
      var avg_lon = res[1]
      var markers = res[2]

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











export class LocationClusterMap extends Component {
  constructor(props) {
    super(props)
    this.preprocess = this.preprocess.bind(this)

  }

  componentDidMount() {
    if (!this.props.fetchedLocationClusters) {
      this.props.dispatch(fetchLocationClusters())
    }
  }


  preprocess() {

    var markers = this.props.locationClusters.map(function(loc){
      if (loc[0]!=0) {
        return (
          <Marker position={[loc[0], loc[1]]}>
          </Marker>
        )
      }
    })
    return markers
  }


  render() {
    if (this.props.fetchedLocationClusters) {
      var markers = this.preprocess()

      return (
        <Segment style={{zIndex:2, height:this.props.height,padding:0}}>
          <Map style={{height:this.props.height}} center={[40,0]} zoom={1}>
            <TileLayer
              attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
              url='http://{s}.tile.osm.org/{z}/{x}/{y}.png'/>
            {markers}
          </Map>
        </Segment>
      )
    }

    else {
      return (
        <Segment style={{height:this.props.height}}><Loader active>Map loading...</Loader></Segment>
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


EventMap = connect((store)=>{
  return {
    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,
  }
})(EventMap)


LocationClusterMap = connect((store)=>{
  return {
    locationClusters: store.util.locationClusters,
    fetchingLocationClusters: store.util.fetchingLocationClusters,
    fetchedLocationClusters: store.util.fetchedLocationClusters,
  }
})(LocationClusterMap)

