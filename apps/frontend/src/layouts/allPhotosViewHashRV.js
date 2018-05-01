import React, {Component} from 'react';
import ReactDOM from 'react-dom';
import { List, WindowScroller,AutoSizer } from 'react-virtualized';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";
import {  fetchDateAlbumsPhotoHashList,fetchAlbumsDateGalleries} from '../actions/albumsActions'
import {  fetchPhotoDetail} from '../actions/photosActions'
import { Card, Image, Header, Divider, Item, Loader, Dimmer, Modal, Sticky, Portal, Grid,
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




class DayGroupPlaceholder extends Component {
    render () {
        var numRows = Math.ceil(this.props.day.photos.length/this.props.numItemsPerRow.toFixed(1))
        var gridHeight = this.props.itemSize * numRows
        var photos = this.props.day.photos.map(function(photo) {
            return (
            <Image key={'daygroup_placholder_image_'+photo.image_hash} style={{display:'inline-block',padding:1,margin:0}}
                height={this.props.itemSize} 
                width={this.props.itemSize} 
                src={'/thumbnail_placeholder.png'}/>
            )
        },this)
        return (
            <div key={'daygroup_placeholder_'+this.props.day}>
                <div style={{height:DAY_HEADER_HEIGHT,paddingTop:5,paddingBottom:5}}>
                <b>{this.props.day.date}...</b>
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
                <LazyLoad 
                    key={'daygroup_photos_'+photo.image_hash}
                    once
                    offset={100}
                    placeholder={
                        <div style={{display:'inline-block',padding:1,margin:0}}></div>
                    }
                    >
                    <ReactCSSTransitionGroup
                        transitionName="thumbnail"
                        transitionAppear={true}
                        transitionAppearTimeout={300}
                        transitionEnterTimeout={300}
                        transitionLeaveTimeout={300}>
                        <Image key={'daygroup_image_'+photo.image_hash} style={{display:'inline-block',padding:1,margin:0}}
                            onClick={()=>{
                                this.props.onPhotoClick(photo.image_hash)
                                console.log(photo.image_hash,'clicked')
                            }}
                            height={this.props.itemSize} 
                            width={this.props.itemSize} 
                            src={serverAddress+'/media/square_thumbnails_big/'+photo.image_hash+'.jpg'}/>
                    </ReactCSSTransitionGroup>
                </LazyLoad>
            )
        },this)
        var gridHeight = this.props.itemSize * Math.ceil(this.props.day.photos.length/this.props.numItemsPerRow.toFixed(1))
        return (
            <LazyLoad 
                key={'daygroup_grid_'+this.props.day}
                once 
                offset={500}
                placeholder={
                    <DayGroupPlaceholder 
                        numItemsPerRow={this.props.numItemsPerRow} 
                        itemSize={this.props.itemSize} 
                        day={this.props.day}/>}>
                <div style={{}}>
                    <div style={{height:DAY_HEADER_HEIGHT,paddingTop:5,paddingBottom:5}}>
                    <b>{this.props.day.date}</b>
                    </div>
                    <div style={{height:gridHeight}}>
                    {photos}
                    </div>
                </div>
            </LazyLoad>
        )
    }
}

export class AllPhotosHashListViewRV extends Component {

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

        var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15 - 10 - 10 - timelineScrollWidth


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
        return (
            <div key={key} style={style}>
                <div style={{backgroundColor:'white'}}>
                hello from row {rowIndex}
                </div>
            </div>
        )
    }

    rowRenderer = ({index, isScrolling, key, style}) => {
        var rowHeight = this.state.entrySquareSize * Math.ceil(this.props.albumsDatePhotoHashList[index].photos.length/this.state.numEntrySquaresPerRow.toFixed(1)) + DAY_HEADER_HEIGHT

        return (
            <div key={key} style={{...style,height:rowHeight}}>
                <div style={{backgroundColor:'white'}}>
                    <DayGroup 
                        key={index}
                        onPhotoClick={this.onPhotoClick}
                        day={this.props.albumsDatePhotoHashList[index]} 
                        itemSize={this.state.entrySquareSize} 
                        numItemsPerRow={this.state.numEntrySquaresPerRow}/>
                </div>
            </div>
        )
    }

    getRowHeight = ({index}) => {
        var rowHeight = this.state.entrySquareSize * Math.ceil(this.props.albumsDatePhotoHashList[index].photos.length/this.state.numEntrySquaresPerRow.toFixed(1)) + DAY_HEADER_HEIGHT
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

        if ( this.props.idx2hash.length < 1 ||this.props.albumsDatePhotoHashList.length < 1) {
            return (<div><Loader active/></div>)
        }

        return (
            <div style={{paddingRight:timelineScrollWidth}}>
                <WindowScroller
                    ref={this._setRef}
                    scrollElement={window}>
                    {({height, isScrolling, registerChild, onChildScroll, scrollTop}) => {
                        console.log('before returning list, height',height)
                        console.log('before returning list, scrollTop',scrollTop)
                        var totalListHeight = this.props.albumsDatePhotoHashList.map((day,index)=>{
                            return (
                                this.getRowHeight({index})
                            )
                        }).reduce((a,b)=>(a+b),0)
                        console.log(totalListHeight)

                        return (
                            <div className='whoororororo'>
                                <div ref={registerChild} className="WHTHTH">
                                    <List
                                        style={{outline:'none',height:totalListHeight,maxHeight:totalListHeight}}
                                        ref={el => {
                                            window.listEl = el;
                                        }}
                                        onRowsRendered={({ overscanStartIndex, overscanStopIndex, startIndex, stopIndex })=>{
                                            this.setState({currTopRenderedRowIdx:startIndex})
                                            console.log(this.state.currTopRenderedRowIdx)
                                        }}
                                        autoHeight
                                        height={height}
                                        isScrolling={isScrolling}
                                        onScroll={onChildScroll}
                                        overscanRowCount={5}
                                        rowCount={this.props.albumsDatePhotoHashList.length}
                                        rowHeight={this.getRowHeight}
                                        rowRenderer={this.rowRenderer}
                                        scrollTop={scrollTop}
                                        width={this.state.width-leftMenuWidth-15}
                                    />
                                </div>
                                { (
                                    <div style={{
                                        right:0,
                                        top:topMenuHeight + (scrollTop / totalListHeight) * (this.state.height - topMenuHeight - 50 - 10),
                                        position:'fixed',
                                        float:'left',
                                        width:150,
                                        padding:10,
                                        height:50,
                                        zIndex:100,
                                    }}>
                                    <Segment>
                                        
                                        <Icon name='calendar outline'/><b>{this.props.albumsDatePhotoHashList[this.state.currTopRenderedRowIdx].date}</b>
                                        
                                    </Segment>
                                    </div>
                                )}
                            </div>
                        )
                    }}
                    
                    
                </WindowScroller>
                <div style={{
                    backgroundColor:'white',
                    position:'fixed',
                    right:0,
                    top:topMenuHeight,
                    height:this.state.height-topMenuHeight,
                    width:timelineScrollWidth}}>
                        
                </div>


                {this.state.lightboxShow && (
                    <Lightbox
                        mainSrc={serverAddress+'/media/photos/'+this.props.idx2hash[this.state.lightboxImageIndex]+'.jpg'}
                        nextSrc={serverAddress+'/media/photos/'+this.props.idx2hash[(this.state.lightboxImageIndex + 1) % this.props.idx2hash.length]+'.jpg'}
                        prevSrc={serverAddress+'/media/photos/'+this.props.idx2hash[(this.state.lightboxImageIndex - 1) % this.props.idx2hash.length]+'.jpg'}
                        mainSrcThumbnail={serverAddress+'/media/thumbnails_tiny/'+this.props.idx2hash[this.state.lightboxImageIndex]+'.jpg'}
                        nextSrcThumbnail={serverAddress+'/media/thumbnails_tiny/'+this.props.idx2hash[(this.state.lightboxImageIndex + 1) % this.props.idx2hash.length]+'.jpg'}
                        prevSrcThumbnail={serverAddress+'/media/thumbnails_tiny/'+this.props.idx2hash[(this.state.lightboxImageIndex - 1) % this.props.idx2hash.length]+'.jpg'}
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
                                        { this.props.photoDetails.hasOwnProperty(this.props.idx2hash[this.state.lightboxImageIndex]) && (
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
                                                                    {this.props.photoDetails[this.props.idx2hash[this.state.lightboxImageIndex]].exif_timestamp.split('T')[0]}
                                                                </Table.Cell>
                                                            </Table.Row>
                                                            <Table.Row>
                                                                <Table.Cell width={2}>
                                                                    <Icon name='clock'/>
                                                                </Table.Cell>
                                                                <Table.Cell>
                                                                    {this.props.photoDetails[this.props.idx2hash[this.state.lightboxImageIndex]].exif_timestamp.split('T')[1].split('+')[0]}
                                                                </Table.Cell>
                                                            </Table.Row>
                                                            <Table.Row>
                                                                <Table.Cell width={2}>
                                                                    <Icon name='image'/>
                                                                </Table.Cell>
                                                                <Table.Cell>
                                                                    {this.props.photoDetails[this.props.idx2hash[this.state.lightboxImageIndex]].image_path}
                                                                </Table.Cell>
                                                            </Table.Row>
                                                            <Table.Row>
                                                                <Table.Cell width={2}>
                                                                    <Icon name='map'/>
                                                                </Table.Cell>
                                                                <Table.Cell>
                                                                    {this.props.photoDetails[this.props.idx2hash[this.state.lightboxImageIndex]].search_location}
                                                                </Table.Cell>
                                                            </Table.Row>
                                                        </Table.Body>
                                                    </Table>
                                                </div>


                                                <div style={{width:LIGHTBOX_SIDEBAR_WIDTH}}>
                                                <LocationMap zoom={8} photos={[
                                                    this.props.photoDetails[this.props.idx2hash[this.state.lightboxImageIndex]]
                                                ]}/>
                                                </div>

                                                <div style={{
                                                    padding:20,
                                                    lineHeight:'normal',
                                                    whiteSpace:'normal'}}>
                                                        <Label.Group>
                                                        {this.props.photoDetails[this.props.idx2hash[this.state.lightboxImageIndex]].search_captions.split(' , ').map((nc)=>(
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
                            this.getPhotoDetails(this.props.idx2hash[this.state.lightboxImageIndex])
                        }}
                        onMovePrevRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.props.idx2hash.length - 1) % this.props.idx2hash.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            console.log(nextIndex,this.props.idx2hash[nextIndex])
                            this.getPhotoDetails(this.props.idx2hash[nextIndex])
                        }}
                        onMoveNextRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.props.idx2hash.length + 1) % this.props.idx2hash.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            console.log(nextIndex,this.props.idx2hash[nextIndex])
                            this.getPhotoDetails(this.props.idx2hash[nextIndex])
                        }}
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
                        }

                    />
                )}


            </div>
            
        )
    }
}

AllPhotosHashListViewRV = connect((store)=>{
  return {
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
    idx2hash: store.albums.idx2hash,
    albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(AllPhotosHashListViewRV)
