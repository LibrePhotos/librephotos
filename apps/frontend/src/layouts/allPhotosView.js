import React, {Component} from 'react';
import { Card, Image, Header, Divider, Item, Loader, Dimmer, Modal, Grid, 
         Container, Label, Popup, Segment, Button, Icon} from 'semantic-ui-react';
import Gallery from 'react-grid-gallery'
import VisibilitySensor from 'react-visibility-sensor'
import { connect } from "react-redux";
import {
  BrowserRouter as Router,
  Route,
  Link
} from 'react-router-dom'
import {fetchDateAlbumsList,fetchAlbumsDateGalleries} from '../actions/albumsActions'
import { Map, TileLayer, Marker } from 'react-leaflet'
import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';
import {ChartyPhotosScrollbar} from '../components/chartyPhotosScrollbar'
import ReactCSSTransitionGroup from 'react-transition-group/CSSTransitionGroup';

import {ImageInfoTable} from '../components/imageInfoTable'



function calculateDayHeight(numPhotos) {
  if (window.innerWidth < 500) {
    var width = 450
  } else {
    var width = window.innerWidth-100
  }

  var photoSize = 157
  var columnWidth = width - 120
  
  var spacePerRow = Math.floor(columnWidth / photoSize)
  if (spacePerRow >= numPhotos) {
    var numRows = 1
    var numCols = numPhotos
  }
  else {
    var numRows = Math.ceil( numPhotos / spacePerRow )
    var numCols = spacePerRow
  }

  return numRows * photoSize
}

class DayPlaceholder extends Component {
  constructor() {
    super();
    this.state = {
      width:  800,
      height: 182
    }
    this.calculatePlaceholderSize = this.calculatePlaceholderSize.bind(this)
  }

  /**
   * Calculate & Update state of new dimensions
   */
  updateDimensions() {
    if(window.innerWidth < 500) {
      this.setState({ width: 450, height: 102 });
    } else {
      let update_width  = window.innerWidth-100;
      let update_height = Math.round(update_width/4.4);
      this.setState({ width: update_width, height: update_height });
    }
  }

  /**
   * Add event listener
   */
  componentDidMount() {
    this.updateDimensions();
    window.addEventListener("resize", this.updateDimensions.bind(this));
  }

  /**
   * Remove event listener
  componentWillUnmount() {
    window.removeEventListener("resize", this.updateDimensions.bind(this));
  }
   */

  calculatePlaceholderSize() {
    var numPhotos = this.props.numPhotos
    var photoSize = 157
    var columnWidth = this.state.width - 120
    
    var spacePerRow = Math.floor(columnWidth / photoSize)
    if (spacePerRow >= numPhotos) {
      var numRows = 1
      var numCols = numPhotos
    }
    else {
      var numRows = Math.ceil( numPhotos / spacePerRow )
      var numCols = spacePerRow
    }


    var boxHeight = numRows * photoSize
    var boxWidth = numCols * photoSize

    return {height:boxHeight,width:boxWidth}
  }

  render() {
    var size = this.calculatePlaceholderSize()
    var h = `${size.height}px`
    var w = `${size.width}px`

    return (
      <div style={{textAlign:'center', verticalAlign:'center', height:h, width:w, backgroundColor:'#dddddd'}}>
      </div>
    )
  }
}

class ModalPhotoView extends Component {
  render() {
    console.log(this.props.open)
    return(
      <div>
        <Modal open={this.props.open} basic size="fullscreen">
          <div style={{height:'100%'}}>
            <Grid columns={2}>
              <Grid.Column width={12}>
                <Image src={serverAddress+this.props.images[this.props.idx].image_url}/>
              </Grid.Column>
              <Grid.Column width={4}>
                <div>
                  <ImageInfoTable photo={this.props.images[this.props.idx]}/>
                </div>
              </Grid.Column>
            </Grid>
          </div>
        </Modal>
      </div>
    )
  }
}

class PhotoDayGroup extends Component {
  constructor() {
    super()
    this.state = {currentModalPhotoIdx:0, modalOpen:false}
    this.onPhotoClick = this.onPhotoClick.bind(this)
    this.keydownHandler = this.keydownHandler.bind(this)
  }

  keydownHandler(e){
    console.log(e)
    if (e.key=="ArrowRight"){
      this.state.currentModalPhotoIdx += 1
    }
    if (e.key=="ArrowLeft"){
      this.state.currentModalPhotoIdx -= 1
    }
    console.log(this.state.currentModalPhotoIdx)
  }

  componentDidMount() {
    document.addEventListener('keydown',this.keydownHandler)
  }

  onPhotoClick(idx) {
    this.state.currentModalPhotoIdx = idx
    console.log(idx)
  }

  componentWillMount() {
    if (!this.props.albumsDateGalleries.hasOwnProperty(this.props.album.id)) {
      this.props.dispatch(fetchAlbumsDateGalleries(this.props.album.id))
    }
  }
  render() {
    var _this = this
    if (this.props.albumsDateGalleries.hasOwnProperty(this.props.album.id)) {
      var photos = this.props.albumsDateGalleries[this.props.album.id].photos
      var images = this.props.albumsDateGalleries[this.props.album.id].photos.map(function(image,idx){
        return (
          <LazyLoad 
            throttle={300}
            height={150} 
            placeholder={
              <Image 
                height={150} 
                width={150} 
                src={'/thumbnail_placeholder.png'}/>
              }
            >
            <Modal trigger={
              <Image 
                onClick={()=>{_this.onPhotoClick(idx)}}
                height={150} 
                width={150} 
                src={serverAddress+image.square_thumbnail_url}/>        }
              open={_this.state.open} basic size="fullscreen">
              <div style={{height:'100%'}}>
                <Grid columns={2}>
                  <Grid.Column width={12}>
                    <Image src={serverAddress+photos[idx].image_url}/>
                  </Grid.Column>
                  <Grid.Column width={4}>
                    <div>
                      <ImageInfoTable photo={photos[idx]}/>
                    </div>
                  </Grid.Column>
                </Grid>
              </div>
            </Modal>
          </LazyLoad>
        )
      })



      // var images = []
      // for (var idx=0; idx<photos.length; idx++) {
      //   console.log(images)
      //   images.concat([
      //     <LazyLoad 
      //       throttle={300}
      //       height={150} 
      //       placeholder={
      //         <Image 
      //           onClick={this.onPhotoClick}
      //           height={150} 
      //           width={150} 
      //           src={'/thumbnail_placeholder.png'}/>
      //         }
      //       >
      //       <Image 
      //         height={150} 
      //         width={150} 
      //         src={serverAddress+photos[idx].square_thumbnail_url}/>
      //     </LazyLoad>
      //   ])
      // }
      // console.log(images)

      console.log(this.state)
      return(
        <div>
          <Image.Group>
            {images}
          </Image.Group>
          <ModalPhotoView idx={this.state.currentModalPhotoIdx} images={photos} open={this.state.modalOpen}/>
        </div>
      )
    }
    else {
      return(<DayPlaceholder numPhotos={this.props.album.photo_count}/>)
    }
  }
}


class PhotoDayGroupReactGridGallery extends Component {
  componentWillMount() {
    if (!this.props.albumsDateGalleries.hasOwnProperty(this.props.album.id)) {
      this.props.dispatch(fetchAlbumsDateGalleries(this.props.album.id))
    }
  }
  render() {
    if (this.props.albumsDateGalleries.hasOwnProperty(this.props.album.id)) {
      var photos = this.props.albumsDateGalleries[this.props.album.id].photos
      var images = this.props.albumsDateGalleries[this.props.album.id].photos.map(function(image,idx){
        return (
          {
            src:serverAddress+image.image_url,
            thumbnail: serverAddress+image.thumbnail_url,
            thumbnailWidth: image.thumbnail_width,
            thumbnailHeight: image.thumbnail_height,
            isSelected: false,
            caption: image.search_captions
          }
        )
      })


      return(
        <div style={{
            display: "block",
            minHeight: "1px",
            width: "100%",
            overflowX: "hidden",
            overflowY: 'auto'}}>
          <Gallery images={images} rowHeight={150} showLightboxThumbnails={true}/>
        </div>
      )
    }
    else {
      return(<DayPlaceholder numPhotos={this.props.album.photo_count}/>)
    }
  }}



export class AllPhotosView extends Component {
  constructor(props){
    super(props)
  }

  componentWillMount() {
    this.props.dispatch(fetchDateAlbumsList())
  }

  render() {
    if (this.props.fetchedAlbumsDateList) {
      var photoDayGroups = this.props.albumsDateList.map(function(album){
        return (
          <div style={{paddingBottom:'20px'}}>
            <Header dividing as='h2'>
              <Header.Content>
                {album.date}
                <Header.Subheader>{album.photo_count} Photos</Header.Subheader>
              </Header.Content>
            </Header>
            <LazyLoad height={calculateDayHeight()} placeholder={<DayPlaceholder numPhotos={album.photo_count}/>}>

              <PhotoDayGroup album={album}/>
            </LazyLoad>
          </div>
        )
      })
      return (
        <div>
          <div style={{width:'100%', textAlign:'center'}}>
            <Icon.Group size='huge'>
              <Icon inverted circular name='image'/>
            </Icon.Group>
          </div>
          <Header as='h1' icon textAlign='center'>
            <Header.Content>
              Events
              <Header.Subheader>All Photos</Header.Subheader>
              <Header.Subheader>{this.props.albumsDateList.length} Days</Header.Subheader>
            </Header.Content>
          </Header>
          <Divider hidden/>
          {photoDayGroups}
        </div>
      )      
    }
    else {
      return (
        <div>
          <div style={{width:'100%', textAlign:'center'}}>
            <Icon.Group size='huge'>
              <Icon inverted circular name='image'/>
            </Icon.Group>
          </div>
          <Header as='h1' icon textAlign='center'>
            <Header.Content>
              Events
              <Header.Subheader>All Photos</Header.Subheader>
              <Header.Subheader>- Days</Header.Subheader>
            </Header.Content>
          </Header>
          <Divider hidden/>
        </div>
      )
    }
  }
}


PhotoDayGroup = connect((store)=>{
  return {
    albumsDateGalleries: store.albums.albumsDateGalleries,
  }
})(PhotoDayGroup)

PhotoDayGroupReactGridGallery = connect((store)=>{
  return {
    albumsDateGalleries: store.albums.albumsDateGalleries,
  }
})(PhotoDayGroupReactGridGallery)

AllPhotosView = connect((store)=>{
  return {
    albumsDateList: store.albums.albumsDateList,
    fetchingAlbumsDateList: store.albums.fetchingAlbumsDateList,
    fetchedAlbumsDateList: store.albums.fetchedAlbumsDateList,    
  }
})(AllPhotosView)
