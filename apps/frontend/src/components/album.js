import React, {Component} from 'react';
import { Card, Image, Header, Divider, Item, Loader, Dimmer,Rating,
         Container, Label, Popup, Segment, Button, Icon} from 'semantic-ui-react';
import Gallery from 'react-grid-gallery'
import VisibilitySensor from 'react-visibility-sensor'
import { connect } from "react-redux";
import {
  BrowserRouter as Router,
  Route,
  Link
} from 'react-router-dom'
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums} from '../actions/albumsActions'
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
PEOPLE ALBUM
*******************************************************************************/

export class AlbumPeopleCard extends Component {
  render() {
    var album_id = this.props.person.key
    console.log(this.props)
    return (
        <Card>
          <VisibilitySensor>
            <Image 
              as={Link}
              to={`peopleview/${this.props.person.key}`}
              size="big"
              src={serverAddress+this.props.person.face_photo_url}/>
          </VisibilitySensor>
          <Card.Content>
          <Header as='h4'>{this.props.person.text}</Header>
          <Card.Meta>
          {this.props.person.face_count} Photos
          </Card.Meta>        
          </Card.Content>
        </Card>
    )
  }
}

export class AlbumPeopleGallery extends Component {
  componentWillMount() {
    console.log('fetching person album',this.props.match.params.albumID)
    this.props.dispatch(fetchPeopleAlbums(this.props.match.params.albumID))
  }

  componentWillReceiveProps() {
    console.log('component did update', this.props.fetchingAlbumsPeople, this.props.match.params.albumID in this.props.albumsPeople)

  }

  render() {

    if (!this.props.fetchingAlbumsPeople) {
      if (!this.props.match.params.albumID in this.props.albumsPeople){
        this.props.dispatch(fetchPeopleAlbums(this.props.match.params.albumID))      
      }
    }

    var albumID = this.props.match.params.albumID
    console.log(this.props)
    if (this.props.match.params.albumID in this.props.albumsPeople) {
      console.log(albumID)
      var album = this.props.albumsPeople[albumID]
      var mappedRenderablePhotoArray = album.photos.map(function(photo){
        return ({
          src: serverAddress+photo.image_url,
          thumbnail: serverAddress+photo.thumbnail_url,
          thumbnailWidth:photo.thumbnail_width,
          thumbnailHeight:photo.thumbnail_height,
        });
      });
      console.log(album)
      var album_name = album.name

      return (
        <div>
          <Header as='h1'>
            {album_name}
          </Header>
          <Divider/>
          <AlbumLocationMap photos={album.photos}/>
          <div style={{
              display: "block",
              minHeight: "1px",
              width: "100%",
              overflowX: "hidden",
              overflowY: 'auto'}}>
            <Gallery 
              images={mappedRenderablePhotoArray}
              enableImageSelection={false}
              rowHeight={250}/>
          </div>
        </div>
      )

    }
    else {
      return (
        <div style={{
          display:"block",
          width:'100%',
          height:'100%'}}>
          <Dimmer active>
            <Loader/>
          </Dimmer>
        </div>
      )
    }
  }
}

/*******************************************************************************
AUTO GENERATED EVENT ALBUM
*******************************************************************************/

export class AlbumAutoGallery extends Component {
  render() {
    var albumID = this.props.match.params.albumID
    if (this.props.fetchedAlbumsAuto) {
      console.log(albumID)
      var album = this.props.albumsAuto.filter(function(a){
        return a.id == albumID
      })

      var mappedRenderablePhotoArray = album[0].photos.map(function(photo){
        return ({
          src: serverAddress+photo.image_url,
          thumbnail: serverAddress+photo.thumbnail_url,
          thumbnailWidth:photo.thumbnail_width,
          thumbnailHeight:photo.thumbnail_height,
        });
      });

      var mappedPeopleIcons = album[0].people.map(function(person){
        return (
          <Label image>
            <img src={serverAddress+person.face_url}/>
            {person.name}
          </Label>
        )
      })


      console.log(album)
    }
    else {
      var mappedRenderablePhotoArray = []
    }
    return (
      <div style={{
          display: "block",
          minHeight: "1px",
          width: "100%",
          border: "0px solid #ddd",
          overflow: "hidden"}}>
        <Header as='h1'>
          {album[0].title}
        </Header>
        {mappedPeopleIcons}
        <Divider/>
        <AlbumLocationMap photos={album[0].photos}/>
        <Gallery 
          images={mappedRenderablePhotoArray}
          enableImageSelection={false}
          rowHeight={250}/>
      </div>
    )
  }
}

export class AlbumAutoCard extends Component {
  render() {
    var album_id = this.props.album_id
    if (this.props.people.length > 0) {
      var mappedPeopleIcons = this.props.people.map(function(person){
        return (
          <Popup
            key={'album-auto-card-'+album_id+'-'+person.name}
            trigger={<Image height={30} width={30} shape='circular' src={serverAddress+person.face_url}/>}
            position="top center"
            content={person.name}
            size="tiny"
            inverted
            basic/>)
      })
    }
    else {
      // empty placeholder so the extra portion (with face icons) of the cards line up
      var mappedPeopleIcons = (<div style={{height:'30px', width:'30px', verticalAlign:'middle'}}>Nobody</div>)
    }

    return (
        <Card>
          <VisibilitySensor>
            <Image 
              as={Link}
              to={`autoview/${this.props.album_id}`}
              size="big"
              src={this.props.albumCoverURL}/>
          </VisibilitySensor>
          <Card.Content>
          <Header as='h4'>{this.props.albumTitle}</Header>
          <Card.Meta>
          {this.props.timestamp}

          <br/>{this.props.photoCount} Photos
          <br/>{this.props.people.length} People
          <div style={{textAlign:'right'}}>
            <Rating icon='heart' defaultRating={0} maxRating={1} />
          </div>
          </Card.Meta>        
          </Card.Content>
        </Card>
    )
  }
}



AlbumPeopleGallery = connect((store)=>{
  return {
    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
  }
})(AlbumPeopleGallery)


AlbumAutoGallery = connect((store)=>{
  return {
    albumsAuto: store.albums.albumsAuto,
    fetchingAlbumsAuto: store.albums.fetchingAlbumsAuto,
    fetchedAlbumsAuto: store.albums.fetchedAlbumsAuto,
  }
})(AlbumAutoGallery)