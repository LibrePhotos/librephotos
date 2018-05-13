import React, {Component} from 'react';
import ReactDOM from 'react-dom';
import { Grid, List, WindowScroller,AutoSizer } from 'react-virtualized';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";
import {  fetchDateAlbumsPhotoHashList,fetchAlbumsDateGalleries} from '../actions/albumsActions'
import {  fetchPhotoDetail} from '../actions/photosActions'
import { Card, Image, Header, Divider, Item, Loader, Dimmer, Modal, Sticky, Portal, Input,
         Container, Label, Popup, Segment, Button, Icon, Table, Transition} from 'semantic-ui-react';
import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';
// import Lightbox from 'react-image-lightbox';
import {LightBox} from '../components/lightBox'

import {LocationMap} from '../components/maps'
import { push } from 'react-router-redux'
import {searchPhotos} from '../actions/searchActions'
import * as moment from 'moment';
import debounce from 'lodash/debounce'

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


class ScrollSpeed {
  clear = () => {
    this.lastPosition = null;
    this.delta = 0;
  };
  getScrollSpeed(scrollOffset) {
    if (this.lastPosition != null) {
      this.delta = scrollOffset - this.lastPosition;
    }
    this.lastPosition = scrollOffset;

    window.clearTimeout(this._timeout);
    this._timeout = window.setTimeout(this.clear, 50);

    return this.delta;
  }
}


const SPEED_THRESHOLD = 1000; // Tweak this to whatever feels right for your app
const SCROLL_DEBOUNCE_DURATION = 100; // In milliseconds



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
            currTopRenderedRowIdx:0,
            isScrollingFast: false
        }
    }

    getScrollSpeed = new ScrollSpeed().getScrollSpeed;

    handleScroll = ({scrollTop}) => {
        // scrollSpeed represents the number of pixels scrolled since the last scroll event was fired
        const scrollSpeed = Math.abs(this.getScrollSpeed(scrollTop));

        if (scrollSpeed >= SPEED_THRESHOLD) {
          this.setState({
            isScrollingFast: true,
            scrollTop:scrollTop
          });
        }

        // Since this method is debounced, it will only fire once scrolling has stopped for the duration of SCROLL_DEBOUNCE_DURATION
        this.handleScrollEnd();
    }

    handleScrollEnd = debounce(() => {
    const {isScrollingFast} = this.state;

    if (isScrollingFast) {
      this.setState({
        isScrollingFast: false,
      });
    }
    }, SCROLL_DEBOUNCE_DURATION);



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
        const {isScrollingFast} = this.state;
        var photoResIdx = rowIndex * this.state.numEntrySquaresPerRow + columnIndex

        if (isScrollingFast) {
            return (
                <div key={key} style={style}>
                    <div style={{backgroundColor:'white',paddingRight:5}}>
                    <Image 
                        onClick={()=>this.onPhotoClick(photoResIdx)}
                        src={'/thumbnail_placeholder.png'}/>
                    </div>
                </div>            )
        }


        if (photoResIdx < this.props.searchPhotosRes.length) {
            return (
                <div key={key} style={style}>
                    <div style={{backgroundColor:'white',paddingRight:5}}>
                    <Image 
                        onClick={()=>this.onPhotoClick(photoResIdx)}
                        src={serverAddress+'/media/square_thumbnails/'+this.props.searchPhotosRes[photoResIdx].image_hash+'.jpg'}/>
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

        if (this.state.idx2hash.length != this.props.searchPhotosRes.length) {
            this.setState({idx2hash:this.props.searchPhotosRes.map((el)=>el.image_hash)})
        }

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
                    <Container>
                        <Loader active>
                        Searching <b>{this.props.query}</b>...
                        </Loader>
                    </Container>
                )
            }
        }



        return (
            <div style={{paddingRight:timelineScrollWidth}}>

                <div style={{height:60,paddingTop:10,paddingRight:5}}>

                  <Header as='h2'>
                    <Icon name='search' />
                    <Header.Content>
                      Search
                      <Header.Subheader>
                        { 
                            this.props.query ? 
                            (`Showing ${this.props.searchPhotosRes.length} results for "${this.props.query}"`) :
                            ("Search for people, places, things, and time.")
                        }
                      </Header.Subheader>
                    </Header.Content>
                  </Header>
                  
                </div>

                <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
                  {({width}) => (
                    <Grid
                      style={{outline:'none'}}
                      cellRenderer={this.cellRenderer}
                      onScroll={this.handleScroll}
                      columnWidth={this.state.entrySquareSize}
                      columnCount={this.state.numEntrySquaresPerRow}
                      height={this.state.height- topMenuHeight - 60}
                      rowHeight={this.state.entrySquareSize}
                      rowCount={Math.ceil(this.props.searchPhotosRes.length/this.state.numEntrySquaresPerRow.toFixed(1))}
                      width={width}
                    />
                  )}
                </AutoSizer>



                { this.state.lightboxShow && this.props.searchPhotosRes.length > 0 &&
                    <LightBox
                        idx2hash={this.state.idx2hash}
                        lightboxImageIndex={this.state.lightboxImageIndex}

                        onCloseRequest={() => this.setState({ lightboxShow: false })}
                        onImageLoad={()=>{
                            this.getPhotoDetails(this.state.idx2hash[this.state.lightboxImageIndex])
                        }}
                        onMovePrevRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.state.idx2hash.length - 1) % this.state.idx2hash.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            this.getPhotoDetails(this.state.idx2hash[nextIndex])
                        }}
                        onMoveNextRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.state.idx2hash.length + 1) % this.state.idx2hash.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            this.getPhotoDetails(this.state.idx2hash[nextIndex])
                        }}/>
                }

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
