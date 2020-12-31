import React, { Component } from 'react';
import { Card, Image, Header, Divider, Loader, Dimmer, Rating, Label, Popup } from 'semantic-ui-react';
import Gallery from 'react-grid-gallery'
import VisibilitySensor from 'react-visibility-sensor'
import { connect } from "react-redux";
import { BrowserRouter as Link } from 'react-router-dom'
import { fetchPeopleAlbums, toggleAlbumAutoFavorite } from '../actions/albumsActions'
import { Map, TileLayer, Marker } from 'react-leaflet'
import { serverAddress } from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';


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
              url='https://{s}.tile.osm.org/{z}/{x}/{y}.png'/>
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
    if (this.props.person.value==='unknown'){
      var personImageSrc = '/unknown_user.jpg'
    }
    else {
      var personImageSrc = serverAddress + this.props.person.face_photo_url
    }
    return (
        <Card>
          <VisibilitySensor>
            <Image 
              as={Link}
              to={`/person/${this.props.person.key}`}
              size="big"
              src={personImageSrc}/>
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
      if (!(this.props.match.params.albumID in this.props.albumsPeople)){
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
              rowHeight={150}/>
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
        return a.id === albumID
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
          rowHeight={150}/>
      </div>
    )
  }
}

export class AlbumAutoCard extends Component {
  constructor(props){
    super(props)
    this.onRate = this.onRate.bind(this)
  }

  onRate(e,d) {
    if (d.rating === 0) {
      console.log('unfavorited',this.props.album_id)
      var rating = false
    }
    else {
      console.log('favorited',this.props.album_id)
      var rating = true
    }
    this.props.dispatch(toggleAlbumAutoFavorite(this.props.album_id,rating))
  }

  render() {
    var album_id = this.props.album_id
    if (this.props.people.length > 0) {
      var mappedPeopleIcons = this.props.people.map(function(person){
        return (

          <Label key={'auto-album-card-'+album_id+'-person-label-'+person.id} as='a' image>
            <img src={serverAddress+person.face_url} />
            {person.name}
          </Label>

        )
      })
      var peoplePopup = (
        <Popup flowing 
          trigger={<div>{this.props.people.length} People </div>}
          content={<Label.Group>{mappedPeopleIcons}</Label.Group>}/>
      )
    }
    else {
      // empty placeholder so the extra portion (with face icons) of the cards line up
      var peoplePopup = (<div>0 People </div>)
    }

    var rating = null
    if (this.props.favorited) {
      rating = 1
    }
    else {
      rating = 0
    }


    return (
      <Card key={this.props.key}>
          <LazyLoad once height={150} placeholder={
            <Image src={'https://placehold.jp/150x150.png'}/>}>
          <Image 
            as={Link}
            to={`/albums/autoview/${this.props.album_id}`}
            size="big"
            src={this.props.albumCoverURL}/>
          </LazyLoad>
        <Card.Content>
        <Header as='h4'>{this.props.albumTitle}</Header>
        <Card.Meta>
        {this.props.timestamp}

        <br/>{this.props.photoCount} Photos {peoplePopup}

        <div style={{textAlign:'right', position:'absolute',bottom:'10px',right:'10px'}}>
          <Rating icon='heart' defaultRating={rating} maxRating={1} onRate={this.onRate}/>
        </div>
        </Card.Meta>        
        </Card.Content>
      </Card>
    )
  }
}



export class AlbumAutoCardPlainPlaceholder extends Component {
  render() {
    return (
      <div style={{padding:'5px'}}>
        <div style={{
          backgroundColor:"#9f9f9f",
          width:'200px',
          height:'200px',
          borderRadius: "0.3rem"}}>
        </div>
        <div style={{
          backgroundColor:"#d4d4d4",
          width:'200px',
          height:'150px',
          borderRadius: "0.3rem"}}>
        </div>
      </div>
    )
  }
}

export class AlbumAutoCardPlain extends Component {
  constructor(props){
    super(props)
    this.onRate = this.onRate.bind(this)
  }

  onRate(e,d) {
    if (d.rating === 0) {
      console.log('unfavorited',this.props.album.id)
      var rating = false
    }
    else {
      console.log('favorited',this.props.album.id)
      var rating = true
    }
    this.props.dispatch(toggleAlbumAutoFavorite(this.props.album.id,rating))
  }

  render() {
    var rating = null
    if (this.props.album.favorited) {
      rating = 1
    }
    else {
      rating = 0
    }
    var numPeople = this.props.album.people.length
    var albumId = this.props.album.people.id
    if (this.props.album.people.length > 0) {
      var mappedPeopleIcons = this.props.album.people.map(function(person){
        return (
          <Image height={30} width={30} shape='circular' src={serverAddress+person.face_url}/>
        )
      })
      mappedPeopleIcons = (
        <Image.Group>{mappedPeopleIcons}</Image.Group>
      )
    }
    else {
      // empty placeholder so the extra portion (with face icons) of the cards line up
      var mappedPeopleIcons = (<div style={{height:'30px', width:'30px', verticalAlign:'middle'}}></div>)
    }
    return (
      <div style={{padding:'5px'}}>
        <div style={{
          border:'1px solid #dddddd',
          width:'200px',
          height:'350px',
          position:'relative',
          borderRadius: "0.3rem"}}>
          <LazyLoad
            height={200}
            placeholder={
              <Image 
                height={200}
                width={200}
                src={'/thumbnail_placeholder.png'}/>}>
            <Image 
              as={Link}
              to={`/albums/autoview/${this.props.album.id}`}
              height={200} width={200} 
              src={serverAddress+this.props.album.cover_photo_url}/>
          </LazyLoad>
          <div style={{padding:'10px'}}>
            <span style={{fontSize:'15',fontWeight:'bold'}}>{this.props.album.title}</span><br/>
            <div style={{paddingTop:'5px'}}>
              <span style={{color:'grey'}}>{this.props.album.timestamp.split('T')[0]}</span>
            </div>
            <div >
              <span style={{color:'grey',fontWeight:'bold'}}>{this.props.album.photo_count} Photos</span>
            </div>
            <div >
              <Popup
                trigger={
                  <span style={{
                    color:'grey',
                    fontWeight:'bold'}}>
                    {this.props.album.people.length} People
                  </span>}
                content={mappedPeopleIcons}
                basic/>
            </div>
            <div style={{bottom:'10px', right:'10px', position:'absolute'}}>
              <Rating icon='heart' defaultRating={rating} maxRating={1} onRate={this.onRate}/>
            </div>
          </div>
        </div>
      </div>
    )
  }
}



export class AlbumDateCardPlaceholder extends Component {
  constructor(props){
    super(props)
  }
  render() {
    return (
      <Card>
        <VisibilitySensor>
          <Image 
            src={'https://placehold.jp/150x150.png'}/>
        </VisibilitySensor>
        <Card.Content>
        <Header as='h4'>{this.props.timestamp}</Header>
        <Card.Meta>
        <br/>{this.props.photoCount} Photos <div>{this.props.people.length} People </div>

        <div style={{textAlign:'right', position:'absolute',bottom:'10px',right:'10px'}}>
          <Rating icon='heart'/>
        </div>
        </Card.Meta>        
        </Card.Content>
      </Card>
    )
  }
}



export class AlbumDateCard extends Component {
  constructor(props){
    super(props)
    this.onRate = this.onRate.bind(this)
  }

  onRate(e,d) {
    if (d.rating === 0) {
      console.log('unfavorited',this.props.album_id)
      var rating = false
    }
    else {
      console.log('favorited',this.props.album_id)
      var rating = true
    }
  }

  render() {
    var album_id = this.props.album_id
    if (this.props.people.length > 0) {
      var mappedPeopleIcons = this.props.people.map(function(person){
        return (

          <Label key={'date-album-card-'+album_id+'-person-label-'+person.id} as='a' image>
            <img src={serverAddress+person.face_url} />
            {person.name}
          </Label>

        )
      })
      var peoplePopup = (
        <Popup flowing 
          trigger={<div>{this.props.people.length} People </div>}
          content={<Label.Group>{mappedPeopleIcons}</Label.Group>}/>
      )
    }
    else {
      // empty placeholder so the extra portion (with face icons) of the cards line up
      var peoplePopup = (<div>0 People </div>)
    }

    var rating = null
    if (this.props.favorited) {
      rating = 1
    }
    else {
      rating = 0
    }


    return (
      <Card key={this.props.key}>
          <LazyLoad once height={300} placeholder={
            <Image src={'https://placehold.jp/150x150.png'}/>}
          >
            <Image 
              as={Link}
              to={`/albums/dateview/${this.props.album_id}`}
              size="big"
              src={this.props.albumCoverURL}/>
          </LazyLoad>
        <Card.Content>
        <Header as='h4'>{this.props.timestamp}</Header>
        <Card.Meta>
        <br/>{this.props.photoCount} Photos {peoplePopup}

        <div style={{textAlign:'right', position:'absolute',bottom:'10px',right:'10px'}}>
          <Rating icon='heart' defaultRating={rating} maxRating={1} onRate={this.onRate}/>
        </div>
        </Card.Meta>        
        </Card.Content>
      </Card>
    )
  }
}








export class AlbumDateCardPlainPlaceholder extends Component {
  render() {
    return (
      <div style={{paddingLeft:'15px'}}>
        <div style={{
          backgroundColor:"white",
          width:'200px',
          height:'200px'}}>
        </div>
        <div style={{
          width:'200px',
          height:'50px'}}>

          <div style={{padding:'5px'}}>
            <div style={{display:'inline-block',backgroundColor:'#b4b4b4',width:80.96,height:18}}></div><br/>
            
            <div>
            <div style={{display:'inline-block',backgroundColor:'#dbdbdb',width:54.97,height:17}}></div><br/>
            </div>
            
          </div>

        </div>
      </div>
    )
  }
}

export class AlbumDateCardPlain extends Component {
  constructor(props){
    super(props)
    this.onRate = this.onRate.bind(this)
  }

  onRate(e,d) {
    if (d.rating === 0) {
      console.log('unfavorited',this.props.album.id)
      var rating = false
    }
    else {
      console.log('favorited',this.props.album.id)
      var rating = true
    }
  }

  render() {
    var rating = null
    if (this.props.album.favorited) {
      rating = 1
    }
    else {
      rating = 0
    }
    var numPeople = this.props.album.people.length
    return (
      <div style={{paddingLeft:'15px'}}>

        <div style={{
          width:'200px',
          height:'200px'}}>

          <LazyLoad
            height={200}
            placeholder={
              <Image 
                height={200}
                width={200}
                src={'/thumbnail_placeholder.png'}/>}>
            <Image 
              as={Link}
              to={`/albums/dateview/${this.props.album.id}`}
              height={200} width={200} 
              src={serverAddress+this.props.album.cover_photo_url}/>
          </LazyLoad>
        </div>


        <div style={{
          width:'200',
          height:'50px'}}>

          <div style={{padding:'5px'}}>
            <span style={{fontSize:'15',fontWeight:'bold'}}>{this.props.album.date}</span><br/>
            <div>
              <span style={{color:'grey',fontWeight:'bold'}}>{this.props.album.photo_count} Photos</span>
            </div>
          </div>
        </div>


      </div>
    )
  }
}










AlbumAutoCard = connect((store)=>{
  return {}
})(AlbumAutoCard)

AlbumAutoCardPlain = connect((store)=>{
  return {}
})(AlbumAutoCardPlain)


AlbumDateCard = connect((store)=>{
  return {}
})(AlbumDateCard)

AlbumDateCardPlain = connect((store)=>{
  return {}
})(AlbumDateCardPlain)

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
