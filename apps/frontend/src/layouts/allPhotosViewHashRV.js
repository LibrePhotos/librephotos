import React, {Component} from 'react';
import ReactDOM from 'react-dom';
import { Grid, WindowScroller,AutoSizer } from 'react-virtualized';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";

import {  
    fetchDateAlbumsPhotoHashList,
    fetchAlbumsDateGalleries,
    fetchUserAlbumsList,
    editUserAlbum,
    createNewUserAlbum} from '../actions/albumsActions'

import { 
    fetchPhotos, 
    fetchPhotoDetail, 
    setPhotosFavorite,
    setPhotosHidden} from '../actions/photosActions'

import { 
    Card, 
    Image, 
    Header, 
    Divider, 
    Item, 
    Loader, 
    Dimmer, 
    Sticky, 
    Portal, 
    List, 
    Input, 
    Rating, 
    Container, 
    Label, 
    Popup, 
    Segment, 
    Button, 
    Icon, 
    Table, 
    Transition, 
    Breadcrumb} from 'semantic-ui-react';

import {Server, serverAddress} from '../api_client/apiClient'
import {LightBox} from '../components/lightBox'
import LazyLoad from 'react-lazyload';
// import Lightbox from 'react-image-lightbox';
import {LocationMap} from '../components/maps'
import { push } from 'react-router-redux'
import {searchPhotos} from '../actions/searchActions'
import styles from '../App.css';
import Draggable from 'react-draggable';
import debounce from 'lodash/debounce'
import _ from 'lodash'
import * as moment from 'moment';
import Modal from 'react-modal';

import {calculateGridCells, calculateGridCellSize} from '../util/gridUtils'
import {ScrollSpeed, SPEED_THRESHOLD, SCROLL_DEBOUNCE_DURATION} from '../util/scrollUtils'
import {fuzzy_match} from '../util/fuzzyMatch'
import {PhotoListView} from './ReusablePhotoListView'

var TOP_MENU_HEIGHT = 55 // don't change this
var LEFT_MENU_WIDTH = 85 // don't change this
var SIDEBAR_WIDTH = 85
var TIMELINE_SCROLL_WIDTH = 0
var DAY_HEADER_HEIGHT = 70

if (window.innerWidth < 600) {
    var LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth
} else {
    var LIGHTBOX_SIDEBAR_WIDTH = 360
}

const customStyles = {
    content : {
        top:150,
        left:window.innerWidth < 600 ? 15+SIDEBAR_WIDTH : '20%',
        right:window.innerWidth < 600 ? 15 : '20%',
        height:window.innerHeight-300,
        width:window.innerWidth < 600 ? window.innerWidth-30-SIDEBAR_WIDTH : '60%' ,
        overflow:'hidden',
        // paddingRight:0,
        // paddingBottomt:0,
        // paddingLeft:10,
        // paddingTop:10,
        padding:0,
        backgroundColor:'white'
    }
};







export class AllPhotosHashListViewRV extends Component {
    componentDidMount() {
        // this.props.dispatch(fetchPhotos())
        if (this.props.albumsDatePhotoHashList.length < 1) {
            this.props.dispatch(fetchDateAlbumsPhotoHashList())
        }
    }

    render() {
        const {fetchingAlbumsDatePhotoHashList,fetchedAlbumsDatePhotoHashList} = this.props
        return (
            <PhotoListView 
                title={"Photos"}
                loading={fetchingAlbumsDatePhotoHashList}
                titleIconName={'images'}
                photosGroupedByDate={this.props.albumsDatePhotoHashList}
                idx2hash={this.props.idx2hash}
            />
        )
    }
}

AllPhotosHashListViewRV = connect((store)=>{
  return {
    showSidebar: store.ui.showSidebar,

    photos: store.photos.photos,
    fetchingPhotos: store.photos.fetchingPhotos,
    fetchedPhotos: store.photos.fetchedPhotos,

    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,

    idx2hash: store.albums.idx2hash,

    albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(AllPhotosHashListViewRV)
