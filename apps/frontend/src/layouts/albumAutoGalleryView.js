import React, {Component} from 'react';
import { Card, Image, Header, Divider, Item, Loader, Dimmer,
         Container, Label, Popup, Segment, Button, Icon} from 'semantic-ui-react';
import Gallery from 'react-grid-gallery'
import VisibilitySensor from 'react-visibility-sensor'
import { connect } from "react-redux";
import {
  BrowserRouter as Router,
  Route,
  Link
} from 'react-router-dom'
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums, fetchAlbumsAutoGalleries} from '../actions/albumsActions'
import { Map, TileLayer, Marker } from 'react-leaflet'
import {Server, serverAddress} from '../api_client/apiClient'


/*******************************************************************************
COMMON
*******************************************************************************/


export class AlbumLocationMap extends Component {
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
          <Divider/>
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

/*******************************************************************************
AUTO GENERATED EVENT ALBUM
*******************************************************************************/

export class AlbumAutoGalleryView extends Component {
  componentWillMount() {
    this.props.dispatch(fetchAlbumsAutoGalleries(this.props.match.params.albumID))
  }

  render() {
    console.log(this.props)
    var albumID = this.props.match.params.albumID
    if (this.props.albumsAutoGalleries.hasOwnProperty(albumID)) {
      var mappedRenderablePhotoArray = this.props.albumsAutoGalleries[albumID].photos.map(function(photo){
        return ({
          src: serverAddress+photo.image_url,
          thumbnail: serverAddress+photo.thumbnail_url,
          thumbnailWidth:photo.thumbnail_width,
          thumbnailHeight:photo.thumbnail_height,
        });
      });

      var mappedPeopleIcons = this.props.albumsAutoGalleries[albumID].people.map(function(person){
        return (
          <Label image>
            <img src={serverAddress+person.face_url}/>
            {person.name}
          </Label>
        )
      })

      var renderable = (
        <div style={{
            display: "block",
            minHeight: "1px",
            width: "100%",
            border: "0px solid #ddd",
            overflow: "hidden"}}>
          <AlbumLocationMap photos={this.props.albumsAutoGalleries[albumID].photos}/>

        <Header  as='h2' textAlign='center'>
          <Header.Content>
            {this.props.albumsAutoGalleries[albumID].title}
            <Header.Subheader>{this.props.albumsAutoGalleries[albumID].photos.length} Events</Header.Subheader>
            {mappedPeopleIcons}
          </Header.Content>
        </Header>



          <Divider/>
          <Gallery 
            images={mappedRenderablePhotoArray}
            enableImageSelection={false}
            rowHeight={250}/>
        </div>
      )
    }
    else {
      var renderable = (
        <div>
          <Dimmer active>
            <Loader active/>
          </Dimmer>
        </div>
      )
    }
    console.log(renderable)
    return (
      <div>
      {renderable}
      </div>
    )
  }
}



AlbumAutoGalleryView = connect((store)=>{
  return {
    fetchingAlbumsAutoGalleries: store.albums.fetchingAlbumsAutoGalleries,
    fetchedAlbumsAutoGalleries: store.albums.fetchedAlbumsAutoGalleries,
    albumsAutoGalleries: store.albums.albumsAutoGalleries,
  }
})(AlbumAutoGalleryView)

