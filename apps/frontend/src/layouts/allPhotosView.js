import React, { Component } from 'react';
import { Image, Header, Loader, Modal } from 'semantic-ui-react';
import Gallery from 'react-grid-gallery'
import { connect } from "react-redux";
import { fetchDateAlbumsList,fetchAlbumsDateGalleries } from '../actions/albumsActions'
import { serverAddress } from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';
import { ModalPhotoViewVertical } from '../components/modalPhotoView';


var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;


function calculateDayHeight(numPhotos,sidebarVisible) {

  var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15 

  var photoSize = 250
  
  var spacePerRow = Math.floor(columnWidth / photoSize)
  if (spacePerRow >= numPhotos) {
    var numRows = 1
    var numCols = numPhotos
  }
  else {
    var numRows = Math.ceil( numPhotos / spacePerRow )
    var numCols = spacePerRow
  }

  return numRows * photoSize + 2
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
   * Add event listener
   */
  componentDidMount() {
    this.calculatePlaceholderSize();
    window.addEventListener("resize", this.calculatePlaceholderSize.bind(this));
  }

  /**
   * Remove event listener
  componentWillUnmount() {
    window.removeEventListener("resize", this.updateDimensions.bind(this));
  }
   */

  calculatePlaceholderSize() {
    var numPhotos = this.props.numPhotos
    var photoSize = 250
    // var columnWidth = this.state.width - 120


    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15



    var spacePerRow = Math.floor(columnWidth / photoSize)
    if (spacePerRow >= numPhotos) {
      var numRows = 1
      var numCols = numPhotos
    }
    else {
      var numRows = Math.ceil( numPhotos / spacePerRow )
      var numCols = spacePerRow
    }


    var boxHeight = numRows * photoSize + 2
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
        backgroundColor:'white'}}>
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
            offset={1000}
            key={'thumbnail_'+image.image_hash}
            debounce={300}
            height={250} 
            placeholder={
              <Image style={{marginLeft:0,marginRight:0,marginTop:0,marginBottom:0,paddingLeft:1,paddingRight:1,paddingTop:1,paddingBottom:1}}
                key={'thumbnailPlaceholder_'+image.image_hash}
                height={250} 
                width={250} 
                src={'/thumbnail_placeholder.png'}/>
              }
            >

              <Image style={{marginLeft:0,marginRight:0,marginTop:0,marginBottom:0,paddingLeft:1,paddingRight:1,paddingTop:1,paddingBottom:1}}
                key={image.image_hash}
                onClick={()=>{this.onPhotoClick(idx)}}
                height={250} 
                width={250} 
                src={serverAddress+image.square_thumbnail_url}/>


          </LazyLoad>  
        )
      },this)
      return(
        <div ref="photoGroupRef">
          <Image.Group style={{marginLeft:0,marginRight:0,marginTop:0,marginBottom:0,paddingLeft:1,paddingRight:1,paddingTop:1,paddingBottom:1}}>
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
      return(<DayPlaceholder sidebarVisible={this.props.sidebarVisible} numPhotos={this.props.album.photo_count}/>)
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
          <Gallery images={images} rowHeight={250} showLightboxThumbnails={true}/>
        </div>
      )
    }
    else {
      return(<DayPlaceholder sidebarVisible={this.props.sidebarVisible} numPhotos={this.props.album.photo_count}/>)
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
              offset={1000}
              unmountIfInvisible={false}
              height={calculateDayHeight(album.photo_count,this.props.sidebarVisible)} 
              placeholder={(
                <div style={{height:calculateDayHeight(album.photo_count,this.props.sidebarVisible)}}></div>
              )}>

              <PhotoDayGroup sidebarVisible={true} key={'photoDayGroup_'+album.id} album={album}/>

            </LazyLoad>
          </div>
        )
      },this)
      return (
        <div>
          {photoDayGroups}
        </div>
      )      
    }
    else {
      return (
        <div style={{paddingTop:'20%'}}>
          <Loader active inline='centered' />
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
