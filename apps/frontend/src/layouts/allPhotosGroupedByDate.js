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
import {fetchPhotos} from '../actions/photosActions'
import { Map, TileLayer, Marker } from 'react-leaflet'
import {Server, serverAddress} from '../api_client/apiClient'
import {fetchDateAlbumsList} from '../actions/albumsActions'
import LazyLoad from 'react-lazyload';

        // <div style={{
        //     display: "block",
        //     minHeight: "1px",
        //     width: "100%",
        //     padding: '10px',
        //     overflowX: "hidden",
        //     overflowY: 'auto'}}>
        //   <Gallery 
        //     images={mappedRenderablePhotoArray}
        //     enableImageSelection={false}
        //     rowHeight={250}/>
        // </div>

class ImagePlaceholder extends Component {
  render () {
    return (
      <Image height={150} width={150} src={'http://placehold.jp/150x150.png'}/>
    )
  }
}

export class AllPhotosGroupedByDate extends Component {
  constructor(props){
    super(props)
    this.groupPhotosByDate = this.groupPhotosByDate.bind(this)
    this.receivedAllProps = this.receivedAllProps.bind(this)
  }

  receivedAllProps() {
    if (this.props.fetchedPhotos && 
        !this.props.photos.length==0 && 
        !this.props.fetchingPhotos &&
        this.props.fetchedPhotos) {

      console.log("fetchedPhotos",this.props.fetchedPhotos)
      console.log("photos",this.props.photos.length)
      console.log("fetchingPhotos",this.props.fetchingPhotos)
      console.log("fetchedPhotos",this.props.fetchedPhotos)
      console.log("albumsDateList",this.props.albumsDateList.length)
      console.log("fetchingAlbumsDateList",this.props.fetchingAlbumsDateList)
      console.log("fetchedAlbumsDateList",this.props.fetchedAlbumsDateList)


      return true
    }
    else {
      return false
    }
  }

  componentWillMount() {
    this.props.dispatch(fetchPhotos())
  }

  groupPhotosByDate() {
    var photosGroupedByDate = {}
    photosGroupedByDate['Unknown Date'] = []

    this.props.photos.map(function(photo){
      if (photo.exif_timestamp != null) {
        var date = photo.exif_timestamp.split('T')[0]
        if (photosGroupedByDate.hasOwnProperty(date)){
          photosGroupedByDate[date].push(photo)
        }
        else{
          photosGroupedByDate[date] = []
          photosGroupedByDate[date].push(photo)
        }
      }
      else {
        photosGroupedByDate['Unknown Date'].push(photo)        
      }
    })
    console.log(photosGroupedByDate)
    return photosGroupedByDate
  }


  groupedPhotosToImageGrids(groupedPhotos) {
    var imageGrids = []
    for (var date in groupedPhotos) {
      if (groupedPhotos.hasOwnProperty(date)) {
        var imageGrid = groupedPhotos[date].map(function(photo){
          console.log(photo.thumbnail_url)
          return (
            <LazyLoad once offset={[150,150]} height={150} placeholder={<ImagePlaceholder/>}>
              <Image height={150} width={150} src={serverAddress+photo.square_thumbnail_url}/>
            </LazyLoad>

          )
        })
        var renderableImageGrid = (
          <div key={date} style={{paddingBottom:'20px'}}>

            <Header as='h2'>
              <Header.Content>
              {date}
              <Header.Subheader>
              {imageGrid.length} Photos
              </Header.Subheader>
              </Header.Content>
            </Header>
            
            <LazyLoad height={100} placeholder={<div style={{height:'157px', width:'157px', backgroundColor:'#dddddd'}}>loading</div>}>
            <Image.Group>
              {imageGrid}
            </Image.Group>
            </LazyLoad>
          </div>
        )
        imageGrids.push(renderableImageGrid)
      }
    }
    return imageGrids
  }


  render() {
    console.log('received all props?', this.receivedAllProps())
    if (this.props.fetchedPhotos){
      var groupedPhotos = this.groupPhotosByDate()
      var renderable = this.groupedPhotosToImageGrids(groupedPhotos)
    }
    else {
      var renderable = (
        <div>
          <Dimmer active>
            <Loader active>
              <Header color='grey'>Loading Photos</Header>
              {"If you just added a lot of photos, or haven't visited this page in a while, "} 
              {"this might take a long time, depending on the number of photos in your library. "}
              {"After the intial load, subsequent visits to this page should be faster from caching."}
            </Loader>
          </Dimmer>
        </div>
      )
    }
    return (
      <div>
        <div>
        <div style={{width:'100%', textAlign:'center'}}>
          <Icon.Group size='huge'>
            <Icon inverted circular name='image'/>
            <Icon inverted circular corner name='wizard'/>
          </Icon.Group>
        </div>
        <Header as='h1' icon textAlign='center'>
          <Header.Content>
            Photos
            <Header.Subheader>{"All ya'll's photos"}</Header.Subheader>
            <Header.Subheader>{this.props.photos.length} Photos</Header.Subheader>
          </Header.Content>
        </Header>
        </div>
        {renderable}
      </div>
    )
  }
}




AllPhotosGroupedByDate = connect((store)=>{
  return {
    fetchedPhotos: store.photos.fetchedPhotos,
    fetchingPhotos: store.photos.fetchingPhotos,
    photos: store.photos.photos,    
    albumsDateList: store.albums.albumsDateList,
    fetchingAlbumsDateList: store.albums.fetchingAlbumsDateList,
    fetchedAlbumsDateList: store.albums.fetchedAlbumsDateList,
  }
})(AllPhotosGroupedByDate)
