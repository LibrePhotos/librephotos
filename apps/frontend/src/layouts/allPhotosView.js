import React, {Component} from 'react';
import { Card, Image, Header, Divider, Item, Loader, Dimmer, Modal, Grid, Sticky,
         Container, Label, Popup, Segment, Button, Icon, Table, Transition} from 'semantic-ui-react';
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
import {ModalPhotoViewVertical} from '../components/modalPhotoView';

import ContentLoader from "react-content-loader"

var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

function calculateDayHeight(numPhotos) {
  if (window.innerWidth < 500) {
    var width = 450
  } else {
    var width = window.innerWidth-100
  }

  var photoSize = 107
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
      if (this.refs.placeholderRef){
        this.setState({ width: 450, height: 102 });
      }
    } else {
      let update_width  = window.innerWidth-100;
      let update_height = Math.round(update_width/4.4);
      if (this.refs.placeholderRef) {
        this.setState({ width: update_width, height: update_height });
      }
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
    var photoSize = 107
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
      <div ref="placeholderRef" style={{
        textAlign:'center', 
        verticalAlign:'center', 
        height:h, 
        width:w, 
        backgroundColor:'#dddddd'}}>
      </div>
    )
  }
}

class PhotoDayGroup extends Component {
  constructor() {
    super()
    this.state = {modalPhotoIndex:0, showModal:false}
    this.onPhotoClick = this.onPhotoClick.bind(this)
    this._handleKeyDown = this._handleKeyDown.bind(this)
  }

  _handleKeyDown (event) {
      switch( event.keyCode ) {
          case ESCAPE_KEY:
              if (this.refs.photoGroupRef){
                this.setState({showModal:false});                
              }
              break;
          case RIGHT_ARROW_KEY:
              if (this.state.modalPhotoIndex < this.props.albumsDateGalleries[this.props.album.id].photos.length-1) {
                if (this.refs.photoGroupRef) {
                  this.setState({modalPhotoIndex:this.state.modalPhotoIndex+1})
                }
              }
              break;
          case LEFT_ARROW_KEY:
              if (this.state.modalPhotoIndex > 0) {
                if (this.refs.photoGroupRef){
                  this.setState({modalPhotoIndex:this.state.modalPhotoIndex-1})
                }
              }
              break;
          default: 
              break;
      }
  }


  componentWillUnmount() {
    document.removeEventListener("keydown", this._handleKeyDown.bind(this));
  }


  onPhotoClick(idx) {
    this.setState({modalPhotoIndex:idx,showModal:true})

  }

  componentWillMount() {

    if (!this.props.albumsDateGalleries.hasOwnProperty(this.props.album.id)) {
      this.props.dispatch(fetchAlbumsDateGalleries(this.props.album.id))
    }
    document.addEventListener('keydown',this._handleKeyDown)
  }

  render() {
    if (this.props.albumsDateGalleries.hasOwnProperty(this.props.album.id)) {
      var photos = this.props.albumsDateGalleries[this.props.album.id].photos
      var images = this.props.albumsDateGalleries[this.props.album.id].photos.map(function(image,idx){
        return (
          <LazyLoad 
            key={'thumbnail_'+image.image_hash}
            debounce={100}
            height={100} 
            placeholder={
              <Image 
                height={100} 
                width={100} 
                src={'/thumbnail_placeholder.png'}/>
              }
            >

            <ReactCSSTransitionGroup
              transitionName="example"
              transitionAppear={true}
              transitionAppearTimeout={500}
              transitionEnterTimeout={500}
              transitionLeaveTimeout={300}>

              <Image 
                key={image.image_hash}
                onClick={()=>{this.onPhotoClick(idx)}}
                height={100} 
                width={100} 
                src={serverAddress+image.square_thumbnail_url}/>

            </ReactCSSTransitionGroup>

          </LazyLoad>  
        )
      },this)
      return(
        <div ref="photoGroupRef">
          <Image.Group>
            {images}
          </Image.Group>

          <Modal 
            basic
            size='fullscreen'
            open={this.state.showModal}
            onClose={(e)=>{this.setState({showModal:false})}}>
            <Modal.Header style={{textAlign:'center'}}>
            Showing photos from <b>{this.props.album.date}</b> ({this.state.modalPhotoIndex+1}/{images.length})
            </Modal.Header>
            <ModalPhotoViewVertical 
              open={this.state.showModal} 
              photos={photos} 
              idx={this.state.modalPhotoIndex} />
          </Modal>

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
          <Gallery images={images} rowHeight={100} showLightboxThumbnails={true}/>
        </div>
      )
    }
    else {
      return(<DayPlaceholder numPhotos={this.props.album.photo_count}/>)
    }
  }}



export class AllPhotosView extends Component {

  componentWillMount() {
    this.props.dispatch(fetchDateAlbumsList())
  }


  render() {
    if (this.props.fetchedAlbumsDateList) {
      var photoDayGroups = this.props.albumsDateList.map(function(album){
        return (
          <div style={{paddingBottom:'20px'}} key={'album_'+album.date}>
            <Header dividing as='h2'>
              <Header.Content>
                {album.date}
                <Header.Subheader>{album.photo_count} Photos</Header.Subheader>
              </Header.Content>
            </Header>
            <LazyLoad 
              debounce={100}
              unmountIfInvisible={false}
              height={calculateDayHeight()} 
              placeholder={(
                <DayPlaceholder numPhotos={album.photo_count}/>
              )}>

              <PhotoDayGroup key={'photoDayGroup_'+album.id} album={album}/>

            </LazyLoad>
          </div>
        )
      },this)
      return (
        <div>
          <div style={{width:'100%', textAlign:'center'}}>
            <Icon.Group size='huge'>
              <Icon inverted circular name='image'/>
            </Icon.Group>
          </div>
          <Header as='h1' icon textAlign='center'>
            <Header.Content>
              All Photos
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
