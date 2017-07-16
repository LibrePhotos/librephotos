import React, {Component} from 'react';
import { Card, Image, Header, Divider, Item, 
         Container, Label, Popup, Segment} from 'semantic-ui-react';
import Server from '../api_client/apiClient';
import Gallery from 'react-grid-gallery'
import VisibilitySensor from 'react-visibility-sensor'
import { connect } from "react-redux";
import {
  BrowserRouter as Router,
  Route,
  Link
} from 'react-router-dom'
import {fetchPeopleAlbums, fetchAutoAlbums} from '../actions/albumsActions'
import { Map, TileLayer, Marker } from 'react-leaflet'

/*
export class AlbumPeopleCard extends Component {
  render() {
    return (
      <Card>
        <VisibilitySensor>
          <Image 
            size="big"
            src={this.props.albumCoverURL}/>
        </VisibilitySensor>
        <Card.Content>
        <Header as='h4'>{this.props.albumTitle}</Header>
        <Card.Meta>
        {this.props.photoCount} Photos
        </Card.Meta>        
        </Card.Content>
      </Card>
    )
  }
}
*/



export class AlbumPeopleCard extends Component {
  render() {
    var album_id = this.props.album_id
    console.log(this.props)
    return (
        <Card>
          <VisibilitySensor>
            <Image 
              as={Link}
              to={`peopleview/${this.props.album_id}`}
              size="big"
              src={this.props.albumCoverURL}/>
          </VisibilitySensor>
          <Card.Content>
          <Header as='h4'>{this.props.albumTitle}</Header>
          <Card.Meta>
          {this.props.photoCount} Photos
          <br/>{this.props.timestamp}
          </Card.Meta>        
          </Card.Content>
        </Card>
    )
  }
}







export class AlbumPeopleCardGroup extends Component {
  componentWillMount() {
    this.props.dispatch(fetchPeopleAlbums())
  }
  render() {
    if (this.props.fetchedAlbumsPeople) {
      var match = this.props.match
      var mappedAlbumCards = this.props.albumsPeople.map(function(album){
        console.log(album)
        var albumTitle = album.name
        try {
          var albumCoverURL = album.photos[0].square_thumbnail_url
        }
        catch(err) {
          var albumCoverURL = null
        }
        return (
          <AlbumPeopleCard
            match={match}
            key={'album-person-'+album.id}
            albumTitle={albumTitle}
            album_id={album.id}
            albumCoverURL={'http://localhost:8000'+albumCoverURL}
            photoCount={album.photos.length}/>
        )
      })
    }
    else {
      var mappedAlbumCards = null
    }
    console.log(this.props)
    return (
      <Container fluid>
        <Card.Group stackable itemsPerRow={4}>
          {mappedAlbumCards}
        </Card.Group>
      </Container>
    )
  }
}












export class AlbumPeopleGallery extends Component {
  render() {

    var albumID = this.props.match.params.albumID
    console.log(this.props)
    if (this.props.fetchedAlbumsPeople) {
      console.log(albumID)
      var album = this.props.albumsPeople.filter(function(a){
        return a.id == albumID
      })

      var mappedRenderablePhotoArray = album[0].photos.map(function(photo){
        return ({
          src: "http://localhost:8000"+photo.image_url,
          thumbnail: "http://localhost:8000"+photo.thumbnail_url,
          thumbnailWidth:photo.thumbnail_width,
          thumbnailHeight:photo.thumbnail_height,
        });
      });

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
          overflowX: "hidden",
          overflowY: 'auto'}}>
        <Header as='h1'>
          {album[0].name}
        </Header>
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
          src: "http://localhost:8000"+photo.image_url,
          thumbnail: "http://localhost:8000"+photo.thumbnail_url,
          thumbnailWidth:photo.thumbnail_width,
          thumbnailHeight:photo.thumbnail_height,
        });
      });

      var mappedPeopleIcons = album[0].people.map(function(person){
        return (
          <Label image>
            <img src={'http://localhost:8000'+person.face_url}/>
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
            trigger={<Image height={30} width={30} shape='circular' src={'http://localhost:8000'+person.face_url}/>}
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
          {this.props.photoCount} Photos
          <br/>{this.props.timestamp}
          </Card.Meta>        
          </Card.Content>
          <Card.Content extra>
          {mappedPeopleIcons}
          </Card.Content>
        </Card>
    )
  }
}



export class AlbumAutoCardGroup extends Component {
  componentWillMount() {
    this.props.dispatch(fetchAutoAlbums())
  }
  render() {
    if (this.props.fetchedAlbumsAuto) {
      var match = this.props.match
      var mappedAlbumCards = this.props.albumsAuto.map(function(album){
        var albumTitle = album.title
        var albumDate = album.timestamp.split('T')[0]
        try {
          var albumCoverURL = album.photos[0].square_thumbnail_url
        }
        catch(err) {
          console.log(err)
          var albumCoverURL = null
        }
        return (

          <AlbumAutoCard 
            match={match}
            key={'album-auto-'+album.id}
            albumTitle={albumTitle}
            timestamp={albumDate}
            people={album.people}
            album_id={album.id}
            albumCoverURL={'http://localhost:8000'+albumCoverURL}
            photoCount={album.photos.length}/>
        )
      })
    }
    else {
      var mappedAlbumCards = null
    }
    return (
      <Container fluid>
      <Card.Group stackable itemsPerRow={4}>
      {mappedAlbumCards}
      </Card.Group>
      </Container>
    )
  }
}


AlbumPeopleCardGroup = connect((store)=>{
  return {
    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
  }
})(AlbumPeopleCardGroup)

AlbumPeopleGallery = connect((store)=>{
  return {
    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
  }
})(AlbumPeopleGallery)






AlbumAutoCardGroup = connect((store)=>{
  return {
    albumsAuto: store.albums.albumsAuto,
    fetchingAlbumsAuto: store.albums.fetchingAlbumsAuto,
    fetchedAlbumsAuto: store.albums.fetchedAlbumsAuto,
  }
})(AlbumAutoCardGroup)

AlbumAutoGallery = connect((store)=>{
  return {
    albumsAuto: store.albums.albumsAuto,
    fetchingAlbumsAuto: store.albums.fetchingAlbumsAuto,
    fetchedAlbumsAuto: store.albums.fetchedAlbumsAuto,
  }
})(AlbumAutoGallery)