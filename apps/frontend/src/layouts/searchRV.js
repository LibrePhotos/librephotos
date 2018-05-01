import React, {Component} from 'react';
import ReactDOM from 'react-dom';
import { Grid, List, WindowScroller,AutoSizer } from 'react-virtualized';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";
import {  fetchDateAlbumsPhotoHashList,fetchAlbumsDateGalleries} from '../actions/albumsActions'
import {  fetchPhotoDetail} from '../actions/photosActions'
import { Card, Image, Header, Divider, Item, Loader, Dimmer, Modal, Sticky, Portal, Input,
         Container, Label, Popup, Segment, Button, Icon, Table, Transition} from 'semantic-ui-react';
import ReactCSSTransitionGroup from 'react-transition-group/CSSTransitionGroup';
import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';
import Lightbox from 'react-image-lightbox';
import {LocationMap} from '../components/maps'
import { push } from 'react-router-redux'
import {searchPhotos} from '../actions/searchActions'

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





export class SearchViewRV extends Component {

    constructor(props){
        super(props)
        this.cellRenderer = this.cellRenderer.bind(this)
        this.getRowHeight = this.getRowHeight.bind(this)
        this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
        this.onPhotoClick = this.onPhotoClick.bind(this)
        this.getPhotoDetails = this.getPhotoDetails.bind(this)
        this.state = {
            idx2hash: [],
            lightboxImageIndex: 1,
            lightboxShow:false,
            lightboxSidebarShow:false,
            scrollToIndex: undefined,
            width:  window.innerWidth,
            height: window.innerHeight,
            entrySquareSize:200,
            currTopRenderedRowIdx:0
        }
    }
    componentWillMount() {
        if (this.props.albumsDatePhotoHashList.length < 1) {
            this.props.dispatch(fetchDateAlbumsPhotoHashList())
        }
        this.calculateEntrySquareSize();
        window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
    }

    calculateEntrySquareSize() {
        if (window.innerWidth < 600) {
            var numEntrySquaresPerRow = 3
        } 
        else if (window.innerWidth < 800) {
            var numEntrySquaresPerRow = 4
        }
        else if (window.innerWidth < 1000) {
            var numEntrySquaresPerRow = 5
        }
        else if (window.innerWidth < 1200) {
            var numEntrySquaresPerRow = 6
        }
        else {
            var numEntrySquaresPerRow = 8
        }

        var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 15


        var entrySquareSize = columnWidth / numEntrySquaresPerRow
        var numEntrySquaresPerRow = numEntrySquaresPerRow
        this.setState({
            width:  window.innerWidth,
            height: window.innerHeight,
            entrySquareSize:entrySquareSize,
            numEntrySquaresPerRow:numEntrySquaresPerRow
        })
        console.log('column width:',columnWidth)
        console.log('item size:',entrySquareSize)
        console.log('num items per row',numEntrySquaresPerRow)
    }

    cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
        var photoResIdx = rowIndex * this.state.numEntrySquaresPerRow + columnIndex
        if (photoResIdx < this.props.searchPhotosRes.length) {
            return (
                <div key={key} style={style}>
                    <div style={{backgroundColor:'white',paddingRight:5}}>
                    <Image 
                        onClick={()=>this.onPhotoClick(photoResIdx)}
                        src={serverAddress+this.props.searchPhotosRes[photoResIdx].square_thumbnail_url}/>
                    </div>
                </div>
            )
        } else {
            return (<div></div>)
        }
    }


    getRowHeight = ({index}) => {
        var rowHeight = this.state.entrySquareSize 
        return (
            rowHeight
        )
    }


    onPhotoClick(idx) {
        console.log('clicked',idx)
        this.setState({lightboxImageIndex:idx,lightboxShow:true})

    }

    _setRef = windowScroller => {
        this._windowScroller = windowScroller;
    };
    
    getPhotoDetails(image_hash) {
        if (!this.props.photoDetails.hasOwnProperty(image_hash)) {
            this.props.dispatch(fetchPhotoDetail(image_hash))
        }
    }

    render() {

        if ( this.props.searchingPhotos ) {
            if ( this.props.query ) {
                return (
                    <div>
                        <Loader active>
                            Searching <b>"{this.props.query}"</b>...
                        </Loader>
                    </div>
                )
            }
        }
        // else {
        //     return (
        //         <div style={{padding:100}}> 
        //             <Header textAlign='center'>
        //             Search for something using the search bar on the top right
        //             </Header>
        //         </div>
        //     )
        // }

        return (
            <div style={{paddingRight:timelineScrollWidth}}>

                <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
                  {({width}) => (
                    <Grid
                      cellRenderer={this.cellRenderer}
                      columnWidth={this.state.entrySquareSize}
                      columnCount={this.state.numEntrySquaresPerRow}
                      height={this.state.height- topMenuHeight }
                      rowHeight={this.state.entrySquareSize}
                      rowCount={Math.ceil(this.props.searchPhotosRes.length/this.state.numEntrySquaresPerRow.toFixed(1))}
                      width={width}
                    />
                  )}
                </AutoSizer>


                {this.state.lightboxShow && (
                    <Lightbox
                        mainSrc={serverAddress+this.props.searchPhotosRes[this.state.lightboxImageIndex].image_url}
                        nextSrc={serverAddress+this.props.searchPhotosRes[(this.state.lightboxImageIndex + 1) % this.props.searchPhotosRes.length].image_url}
                        prevSrc={serverAddress+this.props.searchPhotosRes[(this.state.lightboxImageIndex - 1) % this.props.searchPhotosRes.length].image_url}

                        mainSrcThumbnail={serverAddress+this.props.searchPhotosRes[this.state.lightboxImageIndex].thumbnail_url}
                        nextSrcThumbnail={serverAddress+this.props.searchPhotosRes[(this.state.lightboxImageIndex + 1) % this.props.searchPhotosRes.length].thumbnail_url}
                        prevSrcThumbnail={serverAddress+this.props.searchPhotosRes[(this.state.lightboxImageIndex - 1) % this.props.searchPhotosRes.length].thumbnail_url}
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
                                        zIndex: 1000 }}>
                                        { this.props.photoDetails.hasOwnProperty(this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash) && (
                                            <div style={{width:LIGHTBOX_SIDEBAR_WIDTH}}>
                                                <div style={{paddingLeft:30,paddingRight:30,fontSize:'14px',lineHeight:'normal',whiteSpace:'normal',wordWrap:'break-all'}}>
                                                    <Divider hidden/>
                                                    <Icon name='left arrow' size='big' color='black' onClick={()=>this.setState({lightboxSidebarShow:false})}/>
                                                    <Header as='h3'>Info</Header>
                                                    <Header as='h4'>Details</Header>
                                                    <Table basic='very'  fixed>
                                                        <Table.Body>
                                                            <Table.Row>
                                                                <Table.Cell width={2}>
                                                                    <Icon name='calendar'/>
                                                                </Table.Cell>
                                                                <Table.Cell>
                                                                    {this.props.photoDetails[this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash].exif_timestamp && this.props.photoDetails[this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash].exif_timestamp.split('T')[0]}
                                                                </Table.Cell>
                                                            </Table.Row>
                                                            <Table.Row>
                                                                <Table.Cell width={2}>
                                                                    <Icon name='clock'/>
                                                                </Table.Cell>
                                                                <Table.Cell>
                                                                    {this.props.photoDetails[this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash].exif_timestamp && this.props.photoDetails[this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash].exif_timestamp.split('T')[1].split('+')[0]}
                                                                </Table.Cell>
                                                            </Table.Row>
                                                            <Table.Row>
                                                                <Table.Cell width={2}>
                                                                    <Icon name='image'/>
                                                                </Table.Cell>
                                                                <Table.Cell>
                                                                    {this.props.photoDetails[this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash].image_path}
                                                                </Table.Cell>
                                                            </Table.Row>
                                                            <Table.Row>
                                                                <Table.Cell width={2}>
                                                                    <Icon name='map'/>
                                                                </Table.Cell>
                                                                <Table.Cell>
                                                                    {this.props.photoDetails[this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash].search_location}
                                                                </Table.Cell>
                                                            </Table.Row>
                                                        </Table.Body>
                                                    </Table>
                                                </div>


                                                <div style={{width:LIGHTBOX_SIDEBAR_WIDTH}}>
                                                <LocationMap zoom={8} photos={[
                                                    this.props.photoDetails[this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash]
                                                ]}/>
                                                </div>

                                                <div style={{
                                                    padding:20,
                                                    lineHeight:'normal',
                                                    whiteSpace:'normal'}}>
                                                        <Label.Group>
                                                        {this.props.photoDetails[this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash].search_captions.split(' , ').map((nc)=>(
                                                            <Label 
                                                                onClick={()=>{
                                                                  this.props.dispatch(searchPhotos(nc))
                                                                  this.props.dispatch(push('/search'))
                                                                }}
                                                                circular>
                                                                {nc}
                                                            </Label>
                                                        ))}
                                                        </Label.Group>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </Transition>
                            </div>
                        ]}
                        onCloseRequest={() => this.setState({ lightboxShow: false })}
                        onImageLoad={()=>{
                            this.getPhotoDetails(this.props.searchPhotosRes[this.state.lightboxImageIndex].image_hash)
                        }}
                        onMovePrevRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.props.searchPhotosRes.length - 1) % this.props.searchPhotosRes.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            this.getPhotoDetails(this.props.searchPhotosRes[nextIndex])
                        }}
                        onMoveNextRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.props.searchPhotosRes.length + 1) % this.props.searchPhotosRes.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            this.getPhotoDetails(this.props.searchPhotosRes[nextIndex])
                        }}
                        sidebarWidth={  this.state.lightboxSidebarShow ? LIGHTBOX_SIDEBAR_WIDTH : 0}
                        reactModalStyle={
                            {
                               content: {
                                    right: this.state.lightboxSidebarShow ? LIGHTBOX_SIDEBAR_WIDTH : 0,
                                },
                            }
                        }

                    />
                )}


            </div>
            
        )
    }
}

SearchViewRV = connect((store)=>{
  return {
    searchingPhotos: store.search.searchingPhotos,
    searchedPhotos: store.search.searchedPhotos,
    searchPhotosRes: store.search.searchPhotosRes,
    query: store.search.query,

    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
    idx2hash: store.albums.idx2hash,
    albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(SearchViewRV)
