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
import {fetchDateAlbumsList,fetchAlbumsDateGalleries} from '../actions/albumsActions'
import { Map, TileLayer, Marker } from 'react-leaflet'
import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';
import {ChartyPhotosScrollbar} from '../components/chartyPhotosScrollbar'

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
    return(<div></div>)
  }
}

class PhotoDayGroup extends Component {
  componentWillMount() {
    if (!this.props.albumsDateGalleries.hasOwnProperty(this.props.album.id)) {
      this.props.dispatch(fetchAlbumsDateGalleries(this.props.album.id))
    }
  }
  render() {
    if (this.props.albumsDateGalleries.hasOwnProperty(this.props.album.id)) {
      var images = this.props.albumsDateGalleries[this.props.album.id].photos.map(function(image){
        return (
          <LazyLoad height={150} placeholder={<Image height={150} width={150} src={'http://via.placeholder.com/150x150'}/>}>
            <Image height={150} width={150} src={serverAddress+image.square_thumbnail_url}/>
          </LazyLoad>
        )
      })


      return(
        <div>
          <Image.Group>
            {images}
          </Image.Group>
        </div>
      )
    }
    else {
      return(<DayPlaceholder numPhotos={this.props.album.photo_count}/>)
    }
  }
}

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
            <Header>
              <Header.Content>
                <Header as='h1' dividing>{album.date}</Header>
                <Header.Subheader>{album.photo_count} Photos</Header.Subheader>
              </Header.Content>
            </Header>
            <LazyLoad height={1} placeholder={<DayPlaceholder numPhotos={album.photo_count}/>}>
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
        <Dimmer active>
          <Loader active/>
        </Dimmer>
      )
    }
  }
}


PhotoDayGroup = connect((store)=>{
  return {
    albumsDateGalleries: store.albums.albumsDateGalleries,
  }
})(PhotoDayGroup)


AllPhotosView = connect((store)=>{
  return {
    albumsDateList: store.albums.albumsDateList,
    fetchingAlbumsDateList: store.albums.fetchingAlbumsDateList,
    fetchedAlbumsDateList: store.albums.fetchedAlbumsDateList,    
  }
})(AllPhotosView)
