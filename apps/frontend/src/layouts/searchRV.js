import React, { Component } from 'react';
import { List } from 'react-virtualized';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";
import {  fetchPhotoDetail } from '../actions/photosActions'
import { Image, Header, Loader, Icon } from 'semantic-ui-react';
import { serverAddress } from '../api_client/apiClient'
import { LightBox } from '../components/lightBox'
import * as moment from 'moment';
import debounce from 'lodash/debounce'
import { PhotoListView } from './ReusablePhotoListView'


var TOP_MENU_HEIGHT = 55 // don't change this
var LEFT_MENU_WIDTH = 85 // don't change this
var SIDEBAR_WIDTH = 85
var TIMELINE_SCROLL_WIDTH = 0
var DAY_HEADER_HEIGHT = 70

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





export class SearchView extends Component {
    render() {
        const {searchingPhotos,searchedPhotos,searchQuery} = this.props
        return (
            <PhotoListView 
                title={searchingPhotos ? `Searching "${searchQuery}"...` : searchQuery===null ? "Search for things, places, people, and time." : `"${searchQuery}"`}
                loading={searchingPhotos}
                titleIconName={'search'}
                subtitle={"hehehe"}
                photosGroupedByDate={this.props.searchPhotosResGroupedByDate}
                idx2hash={this.props.idx2hash}
            />
        )
    }
}









class DayGroupPlaceholder extends Component {
    render () {
        var numRows = Math.ceil(this.props.day.photos.length/this.props.numItemsPerRow.toFixed(1))
        var gridHeight = this.props.itemSize * numRows
        var photos = this.props.day.photos.map(function(photo) {
            return (
                <Image key={'daygroup_image_placeholder_'+photo.image_hash} style={{display:'inline-block',padding:1,margin:0}}
                    height={this.props.itemSize} 
                    width={this.props.itemSize} 
                    src={'/thumbnail_placeholder.png'}/>
            )
        },this)
        return (
            <div key={'daygroup_placeholder_'+this.props.day}>
                <div style={{fontSize:17,height:DAY_HEADER_HEIGHT,paddingTop:20,paddingBottom:5}}>
                <Header as='h3'>
                <Icon name='calendar outline'/>
                <Header.Content>
                {moment(this.props.day.date).format("MMM Do YYYY, dddd")}
                <Header.Subheader>
                    <Icon name='photo'/>{this.props.day.photos.length} Photos
                </Header.Subheader>
                </Header.Content>
                </Header>
                </div>
                <div style={{height:gridHeight}}>
                {photos}
                </div>
            </div>
        )
    }
}


class DayGroup extends Component {
    render () {
        var photos = this.props.day.photos.map(function(photo) {
            return (
                <Image key={'daygroup_image_'+photo.image_hash} style={{display:'inline-block',padding:1,margin:0}}
                    onClick={()=>{
                        this.props.onPhotoClick(photo.image_hash)
                    }}
                    height={this.props.itemSize} 
                    width={this.props.itemSize} 
                    src={serverAddress+'/media/square_thumbnails/'+photo.image_hash+'.jpg'}/>
            )
        },this)
        var gridHeight = this.props.itemSize * Math.ceil(this.props.day.photos.length/this.props.numItemsPerRow.toFixed(1))
        return (
            <div key={'daygroup_grid_'+this.props.day} style={{}}>
                <div style={{fontSize:17,height:DAY_HEADER_HEIGHT,paddingTop:20,paddingBottom:5}}>
                <Header as='h3'>
                <Icon name='calendar outline'/>
                <Header.Content>
                {moment(this.props.day.date).format("MMM Do YYYY, dddd")}
                <Header.Subheader>
                    <Icon name='photo'/>{this.props.day.photos.length} Photos
                </Header.Subheader>
                </Header.Content>
                </Header>
                </div>
                <div style={{height:gridHeight}}>
                {photos}
                </div>
            </div>
        )
    }
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
            currTopRenderedRowIdx:0,
            scrollTop:0
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
            var numEntrySquaresPerRow = 6
        }
        else if (window.innerWidth < 1200) {
            var numEntrySquaresPerRow = 6
        }
        else {
            var numEntrySquaresPerRow = 6 
        }

        var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10


        var entrySquareSize = columnWidth / numEntrySquaresPerRow
        var numEntrySquaresPerRow = numEntrySquaresPerRow
        this.setState({
            width:  window.innerWidth,
            height: window.innerHeight,
            entrySquareSize:entrySquareSize,
            numEntrySquaresPerRow:numEntrySquaresPerRow
        })
    }

    cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
        return (
            <div key={key} style={style}>
                <div style={{backgroundColor:'white'}}>
                hello from row {rowIndex}
                </div>
            </div>
        )
    }

    rowRenderer = ({index, isScrolling, key, style}) => {
        const {isScrollingFast} = this.state;
        var rowHeight = this.state.entrySquareSize * Math.ceil(this.props.searchPhotosResGroupedByDate[index].photos.length/this.state.numEntrySquaresPerRow.toFixed(1)) + DAY_HEADER_HEIGHT
        if (isScrollingFast) {
            return (
                <div key={key} style={{...style,height:rowHeight}}>
                    <div style={{backgroundColor:'white'}}>
                    <DayGroupPlaceholder
                        key={index}
                        onPhotoClick={this.onPhotoClick}
                        day={this.props.searchPhotosResGroupedByDate[index]} 
                        itemSize={this.state.entrySquareSize} 
                        numItemsPerRow={this.state.numEntrySquaresPerRow}/>
                    </div>
                </div>
            )
        }
        else {
            return (
                <div key={key} style={{...style,height:rowHeight}}>
                    <div style={{backgroundColor:'white'}}>
                    <DayGroup 
                        key={index}
                        onPhotoClick={this.onPhotoClick}
                        day={this.props.searchPhotosResGroupedByDate[index]} 
                        itemSize={this.state.entrySquareSize} 
                        numItemsPerRow={this.state.numEntrySquaresPerRow}/>
                    </div>
                </div>
            )        }
    }

    getRowHeight = ({index}) => {
        var rowHeight = this.state.entrySquareSize * Math.ceil(this.props.searchPhotosResGroupedByDate[index].photos.length/this.state.numEntrySquaresPerRow.toFixed(1)) + DAY_HEADER_HEIGHT
        return (
            rowHeight
        )
    }


    onPhotoClick(hash) {
        this.setState({lightboxImageIndex:this.props.idx2hash.indexOf(hash),lightboxShow:true})

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
        const {lightboxImageIndex} = this.state
        if ( !this.props.query || this.props.query.length < 0) {
            return (<div>You must search for something</div>)}
        if ( this.props.searchPhotosResGroupedByDate.length < 1 || this.props.searchingPhotos) {
            return (<div><Loader active/></div>)
        }
        var totalListHeight = this.props.searchPhotosResGroupedByDate.map((day,index)=>{
            return (
                this.getRowHeight({index})
            )
        }).reduce((a,b)=>(a+b),0)
        return (
            <div>
                <div style={{height:60,paddingTop:10}}>

                  <Header as='h2'>
                    <Icon name='search' />
                    <Header.Content>
                      Search results for "{this.props.query}"
                      <Header.Subheader>
                        {this.props.searchPhotosResGroupedByDate.length} Days, {this.props.searchPhotosRes.length} Photos
                      </Header.Subheader>
                    </Header.Content>
                  </Header>

                </div>

                    <List
                        style={{outline:'none',paddingRight:0,marginRight:0}}
                        onRowsRendered={({ overscanStartIndex, overscanStopIndex, startIndex, stopIndex })=>{
                            this.setState({currTopRenderedRowIdx:startIndex})
                        }}
                        height={this.state.height-TOP_MENU_HEIGHT-60}
                        overscanRowCount={5}
                        rowCount={this.props.searchPhotosResGroupedByDate.length}
                        rowHeight={this.getRowHeight}
                        rowRenderer={this.rowRenderer}
                        onScroll={this.handleScroll}
                        estimatedRowSize={totalListHeight/this.props.searchPhotosResGroupedByDate.length.toFixed(10)}
                        width={this.state.width-LEFT_MENU_WIDTH-5}/>

            { (
                <div style={{
                    right:0,
                    top:TOP_MENU_HEIGHT + 10+ (0 / totalListHeight) * (this.state.height - TOP_MENU_HEIGHT - 50 - 20),
                    position:'fixed',
                    float:'left',
                    width:180,
                    padding:0,
                    height:50,
                    zIndex:100,
                }}>
                    <div style={{textAlign:'right',paddingRight:30}} className='handle'>
                        <b>{moment(this.props.searchPhotosResGroupedByDate[this.state.currTopRenderedRowIdx].date).format("MMMM YYYY") }</b> <br/>
                    </div>
                    <div style={{textAlign:'right',paddingRight:30}}>
                        {moment(this.props.searchPhotosResGroupedByDate[this.state.currTopRenderedRowIdx].date).fromNow()}
                    </div>
                </div>
            )}

                <div style={{
                    backgroundColor:'white',
                    position:'fixed',
                    right:0,
                    top:TOP_MENU_HEIGHT,
                    height:this.state.height-TOP_MENU_HEIGHT,
                    width:TIMELINE_SCROLL_WIDTH}}>
                        
                </div>

                { this.state.lightboxShow &&
                    <LightBox
                        idx2hash={this.props.idx2hash}
                        lightboxImageIndex={this.state.lightboxImageIndex}

                        onCloseRequest={() => this.setState({ lightboxShow: false })}
                        onImageLoad={()=>{
                            this.getPhotoDetails(this.props.idx2hash[this.state.lightboxImageIndex])
                        }}
                        onMovePrevRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.props.idx2hash.length - 1) % this.props.idx2hash.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            this.getPhotoDetails(this.props.idx2hash[nextIndex])
                        }}
                        onMoveNextRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.props.idx2hash.length + 1) % this.props.idx2hash.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            this.getPhotoDetails(this.props.idx2hash[nextIndex])
                        }}/>
                }
            </div>
        )
    }
}

SearchView = connect((store)=>{
  return {
    searchingPhotos: store.search.searchingPhotos,
    searchedPhotos: store.search.searchedPhotos,
    searchPhotosRes: store.search.searchPhotosRes,
    searchPhotosResGroupedByDate: store.search.searchPhotosResGroupedByDate,
    searchQuery: store.search.query,

    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
    idx2hash: store.search.idx2hash,
    albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(SearchView)


SearchViewRV = connect((store)=>{
  return {
    searchingPhotos: store.search.searchingPhotos,
    searchedPhotos: store.search.searchedPhotos,
    searchPhotosRes: store.search.searchPhotosRes,
    searchPhotosResGroupedByDate: store.search.searchPhotosResGroupedByDate,
    query: store.search.query,

    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
    idx2hash: store.search.idx2hash,
    albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(SearchViewRV)
