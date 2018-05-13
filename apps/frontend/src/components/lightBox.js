import React, {Component} from 'react';
import ReactDOM from 'react-dom';
import { List, WindowScroller,AutoSizer } from 'react-virtualized';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";
import {  fetchDateAlbumsPhotoHashList,fetchAlbumsDateGalleries} from '../actions/albumsActions'
import {  fetchPhotoDetail} from '../actions/photosActions'
import { Card, Image, Header, Divider, Item, Loader, Dimmer, Modal, Sticky, Portal, Grid, List as ListSUI,
         Container, Label, Popup, Segment, Button, Icon, Table, Transition, Breadcrumb} from 'semantic-ui-react';
import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';
import Lightbox from 'react-image-lightbox';
import {LocationMap} from '../components/maps'
import { push } from 'react-router-redux'
import {searchPhotos} from '../actions/searchActions'
import styles from '../App.css';
import Draggable from 'react-draggable';
import debounce from 'lodash/debounce'
import * as moment from 'moment';

var topMenuHeight = 55 // don't change this
var leftMenuWidth = 85 // don't change this
var SIDEBAR_WIDTH = 85
var timelineScrollWidth = 0
var DAY_HEADER_HEIGHT = 35

if (window.innerWidth < 600) {
    var LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth
} else {
    var LIGHTBOX_SIDEBAR_WIDTH = 360
}



const colors = [
  'red', 'orange', 'yellow', 'olive', 'green', 'teal',
  'blue', 'violet', 'purple', 'pink', 'brown', 'grey', 'black',
]




export class LightBox extends Component {
    state = {
        lightboxSidebarShow: false,
    }
    getPhotoDetails(image_hash) {
        if (!this.props.photoDetails.hasOwnProperty(image_hash)) {
            this.props.dispatch(fetchPhotoDetail(image_hash))
        }
    }
    render() {
        console.log(this.state)
        console.log(this.props)
        return (
            <div>
                <Lightbox
                    mainSrc={serverAddress+'/media/photos/'+this.props.idx2hash[this.props.lightboxImageIndex]+'.jpg'}
                    nextSrc={serverAddress+'/media/photos/'+this.props.idx2hash[(this.props.lightboxImageIndex + 1) % this.props.idx2hash.length]+'.jpg'}
                    prevSrc={serverAddress+'/media/photos/'+this.props.idx2hash[(this.props.lightboxImageIndex - 1) % this.props.idx2hash.length]+'.jpg'}
                    mainSrcThumbnail={serverAddress+'/media/thumbnails_tiny/'+this.props.idx2hash[this.props.lightboxImageIndex]+'.jpg'}
                    nextSrcThumbnail={serverAddress+'/media/thumbnails_tiny/'+this.props.idx2hash[(this.props.lightboxImageIndex + 1) % this.props.idx2hash.length]+'.jpg'}
                    prevSrcThumbnail={serverAddress+'/media/thumbnails_tiny/'+this.props.idx2hash[(this.props.lightboxImageIndex - 1) % this.props.idx2hash.length]+'.jpg'}
                    toolbarButtons={[
                        <div>
                            <Button 
                                icon 
                                active={this.state.lightboxSidebarShow}
                                circular
                                onClick={()=>{this.setState({lightboxSidebarShow:!this.state.lightboxSidebarShow})}}>
                                <Icon name='info'/>
                            </Button>
                            <Transition visible={this.state.lightboxSidebarShow} animation='fade left' duration={500}>
                                <div style={{ 
                                    right: 0, 
                                    top:0,
                                    float:'right',
                                    backgroundColor:'white',
                                    width:LIGHTBOX_SIDEBAR_WIDTH, 
                                    height:window.innerHeight,
                                    whiteSpace:'normal',
                                    position: 'fixed', 
                                    overflowY:'scroll',
                                    overflowX:'hidden',
                                    zIndex: 1000 }}>
                                    { this.props.photoDetails.hasOwnProperty(this.props.idx2hash[this.props.lightboxImageIndex]) && (
                                        <div style={{width:LIGHTBOX_SIDEBAR_WIDTH}}>
                                            <div style={{paddingLeft:30,paddingRight:30,fontSize:'14px',lineHeight:'normal',whiteSpace:'normal',wordWrap:'break-all'}}>
                                                <Divider hidden/>
                                                <Header as='h3'>Details</Header>

                                                  <Item.Group relaxed>
                                                    <Item>
                                                      <Item.Content verticalAlign='middle'>
                                                        <Item.Header>
                                                          <Icon name='calendar' /> Time Taken
                                                        </Item.Header>
                                                        <Item.Description>
                                                         {moment(this.props.photoDetails[this.props.idx2hash[this.props.lightboxImageIndex]].exif_timestamp).format("dddd, MMMM Do YYYY, h:mm a")}
                                                        </Item.Description>
                                                      </Item.Content>
                                                    </Item>

                                                    <Item>
                                                      <Item.Content verticalAlign='middle'>
                                                        <Item.Header>
                                                          <Icon name='file' /> File Path
                                                        </Item.Header>
                                                        <Item.Description>
                                                        <Breadcrumb 
                                                            divider={<Icon name='right chevron'/>}
                                                            sections={
                                                            this.props.photoDetails[this.props.idx2hash[this.props.lightboxImageIndex]].image_path.split('/').map((el)=>
                                                            {return({key:el,content:el})} )}/>

                                                        </Item.Description>
                                                      </Item.Content>
                                                    </Item>

                                                    <Item>
                                                      <Item.Content verticalAlign='middle'>
                                                        <Item.Header>
                                                          <Icon name='point' /> Location
                                                        </Item.Header>
                                                        <Item.Description>
                                                          {this.props.photoDetails[this.props.idx2hash[this.props.lightboxImageIndex]].search_location}
                                                        </Item.Description>
                                                      </Item.Content>
                                                    </Item>


                                                    <Item>
                                                      <Item.Content verticalAlign='middle'>
                                                        <Item.Header>
                                                          <Icon name='tags'/> Things
                                                        </Item.Header>
                                                        <Item.Description>
                                                            <Label.Group>
                                                            {this.props.photoDetails[this.props.idx2hash[this.props.lightboxImageIndex]].search_captions.split(' , ').map((nc,idx)=>(
                                                                <Label 
                                                                    color={colors[idx%this.props.photoDetails[this.props.idx2hash[this.props.lightboxImageIndex]].search_captions.split(' , ').length]}
                                                                    onClick={()=>{
                                                                      this.props.dispatch(searchPhotos(nc))
                                                                      this.props.dispatch(push('/search'))
                                                                    }}
                                                                    circular>
                                                                    {nc}
                                                                </Label>
                                                            ))}
                                                            </Label.Group>
                                                        </Item.Description>
                                                      </Item.Content>
                                                    </Item>

                                                    <Item>
                                                      <Item.Content verticalAlign='middle'>
                                                        <Item.Header>
                                                          <Icon name='users'/> People
                                                        </Item.Header>
                                                        <Item.Description>
                                                            <Label.Group>
                                                            {this.props.photoDetails[this.props.idx2hash[this.props.lightboxImageIndex]].people.map((nc,idx)=>(
                                                                <Label 
                                                                    color={colors[idx%this.props.photoDetails[this.props.idx2hash[this.props.lightboxImageIndex]].people.length]}
                                                                    onClick={()=>{
                                                                      this.props.dispatch(searchPhotos(nc))
                                                                      this.props.dispatch(push('/search'))
                                                                    }}
                                                                    >
                                                                    {nc}
                                                                </Label>
                                                            ))}
                                                            </Label.Group>
                                                        </Item.Description>
                                                      </Item.Content>
                                                    </Item>

                                                  </Item.Group>



                                            </div>


                                            <div style={{width:LIGHTBOX_SIDEBAR_WIDTH,whiteSpace:'normal',lineHeight:'normal'}}>
                                            { this.props.photoDetails[this.props.idx2hash[this.props.lightboxImageIndex]].exif_gps_lat &&
                                                (
                                                    <LocationMap zoom={8} photos={[
                                                        this.props.photoDetails[this.props.idx2hash[this.props.lightboxImageIndex]]
                                                    ]}/>
                                                )
                                            }
                                            </div>




                                        </div>
                                    )}
                                </div>
                            </Transition>
                        </div>
                    ]}
                    onCloseRequest={this.props.onCloseRequest}
                    onImageLoad={this.props.onImageLoad}
                    onMovePrevRequest={this.props.onMovePrevRequest}
                    onMoveNextRequest={this.props.onMoveNextRequest}
                    sidebarWidth={  this.state.lightboxSidebarShow ? LIGHTBOX_SIDEBAR_WIDTH : 0}
                    reactModalStyle={
                        {
                           content: {
                                right: this.state.lightboxSidebarShow ? LIGHTBOX_SIDEBAR_WIDTH : 0,
                                //right:LIGHTBOX_SIDEBAR_WIDTH,
                                //width: this.state.lightboxSidebarShow ? window.innerWidth - LIGHTBOX_SIDEBAR_WIDTH : window.innerWidth,
                                //transform: 'translate(-200px,0)',
                                //width: window.innerWidth - LIGHTBOX_SIDEBAR_WIDTH
                            },
                            //overlay: {width: window.innerWidth - LIGHTBOX_SIDEBAR_WIDTH}
                        }
                    }/>
            </div>


        )
        
    }
}



LightBox = connect((store)=>{
  return {
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
    // idx2hash: store.albums.idx2hash,
    // albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    // fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    // fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(LightBox)
