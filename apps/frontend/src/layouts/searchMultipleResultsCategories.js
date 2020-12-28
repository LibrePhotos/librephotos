import React, { Component } from 'react';
import { Grid, AutoSizer } from 'react-virtualized';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";
import { fetchPhotoDetail } from '../actions/photosActions'
import { Image, Header, Loader, Icon } from 'semantic-ui-react';
import { serverAddress } from '../api_client/apiClient'
// import Lightbox from 'react-image-lightbox';
import { LightBox } from '../components/lightBox'
import * as moment from 'moment';
import debounce from 'lodash/debounce'
import { calculateGridCells, calculateGridCellSize } from '../util/gridUtils'
import { ScrollSpeed, SPEED_THRESHOLD, SCROLL_DEBOUNCE_DURATION } from '../util/scrollUtils'


var topMenuHeight = 55 // don't change this
var leftMenuWidth = 85 // don't change this
var SIDEBAR_WIDTH = 85
var timelineScrollWidth = 0
var DAY_HEADER_HEIGHT = 70

if (window.innerWidth < 600) {
    var LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth
} else {
    var LIGHTBOX_SIDEBAR_WIDTH = 360
}


export class SearchMultipleCategories extends Component {

    constructor(props){
        super(props)
        this.cellRenderer = this.cellRenderer.bind(this)
        this.handleResize = this.handleResize.bind(this)
        this.onPhotoClick = this.onPhotoClick.bind(this)
        this.getPhotoDetails = this.getPhotoDetails.bind(this)
        this.listRef = React.createRef()
        this.state = {
            cellContents: [[]],
            hash2row: {},
            idx2hash: [],
            lightboxImageIndex: 1,
            lightboxShow:false,
            lightboxSidebarShow:false,
            scrollToIndex: undefined,
            width:  window.innerWidth,
            height: window.innerHeight,
            entrySquareSize:200,
            numEntrySquaresPerRow:3,
            currTopRenderedRowIdx:0,
            scrollTop:0,
        }
    }

    scrollSpeedHandler = new ScrollSpeed()

    handleScroll = ({scrollTop}) => {
        // scrollSpeed represents the number of pixels scrolled since the last scroll event was fired
        const scrollSpeed = Math.abs(this.scrollSpeedHandler.getScrollSpeed(scrollTop));

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



    componentDidMount() {
        //if (this.props.albumsDatePhotoHashList.length < 1) {
        //    this.props.dispatch(fetchDateAlbumsPhotoHashList())
        //}
        this.handleResize();
        window.addEventListener("resize", this.handleResize.bind(this));
    }
    componentWillUnmount() {
        window.removeEventListener("resize", this.handleResize.bind(this))
        this.scrollSpeedHandler.clearTimeout()
    }

    handleResize() {
        var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10
        const {entrySquareSize,numEntrySquaresPerRow} = calculateGridCellSize(columnWidth)
        var {cellContents,hash2row} = calculateGridCells(this.props.searchPhotosResGroupedByDate,numEntrySquaresPerRow)

        this.setState({
            width:  window.innerWidth,
            height: window.innerHeight,
            entrySquareSize:entrySquareSize,
            numEntrySquaresPerRow:numEntrySquaresPerRow,
            cellContents: cellContents,
            hash2row:hash2row
        })
        if (this.listRef.current) {
            this.listRef.current.recomputeGridSize()
        }
    }

    cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
        if (this.state.cellContents[rowIndex][columnIndex]) { // non-empty cell
            const cell = this.state.cellContents[rowIndex][columnIndex]
            if (cell.date) { // header cell has 'date' attribute
                return ( 
                    <div key={key} style={{...style,width:this.state.width,height:DAY_HEADER_HEIGHT,paddingTop:20}}>
                        <div style={{backgroundColor:'white'}}>
                            <Header as='h3'>
                                <Icon name='calendar outline'/>
                                <Header.Content>
                                    { cell.date=='No Timestamp' ? "No Timestamp" : moment(cell.date).format("MMM Do YYYY, dddd")}
                                    <Header.Subheader>
                                        <Icon name='photo'/>{cell.photos.length} Photos
                                    </Header.Subheader>
                                </Header.Content>
                            </Header>
                        </div>
                    </div>                
                )   
                /*
                if (!this.state.isScrollingFast){
                } else {
                    return (
                        <div key={key} style={{
                            ...style,
                            backgroundColor:'#dddddd',
                            width:250,
                            marginTop:2,
                            height:DAY_HEADER_HEIGHT-4,
                            paddingTop:10}}>
                        </div>                
                    )        
                } 
                */
            } else { // photo cell doesn't have 'date' attribute
                if (!this.state.isScrollingFast) {
                    return (
                        <div key={key} style={style}>
                            <Image key={'daygroup_image_'+cell.image_hash} style={{display:'inline-block',padding:1,margin:0}}
                                onClick={()=>{
                                    this.onPhotoClick(cell.image_hash)
                                }}
                                height={this.state.entrySquareSize} 
                                width={this.state.entrySquareSize} 
                                src={serverAddress+'/media/square_thumbnails/'+cell.image_hash+'.jpg'}/>
                        </div>                                
                    )
                } else {
                    return (
                        <div key={key} style={{...style,
                            width:this.state.entrySquareSize-2,
                            height:this.state.entrySquareSize-2,
                            backgroundColor:'#eeeeee'}}>
                        </div>                                
                    )
                }

            }

        } else { // empty cell
            return (
                <div key={key} style={style}>
                </div>
            )
        }
    }


    onPhotoClick(hash) {
        this.setState({lightboxImageIndex:this.props.idx2hash.indexOf(hash),lightboxShow:true})
    }

    getPhotoDetails(image_hash) {
        if (!this.props.photoDetails.hasOwnProperty(image_hash)) {
            this.props.dispatch(fetchPhotoDetail(image_hash))
        }
    }

    static getDerivedStateFromProps(nextProps,prevState){
        const {cellContents,hash2row} = calculateGridCells(nextProps.searchPhotosResGroupedByDate,prevState.numEntrySquaresPerRow)
        return {...prevState,cellContents,hash2row}
    }


    render() {

        const {lightboxImageIndex} = this.state
        if ( !this.props.query || this.props.query.length < 0) {
            return (<div>You must search for something</div>)}
        if ( !this.props.searchingPhotos && !this.props.searchedPhotos) {
            return (<div>Search failed!</div>)
        }
        if ( this.props.searchingPhotos && !this.props.searchedPhotos) {
            return (<div><Loader active/></div>)
        }
        if (this.props.searchPhotosResGroupedByDate.length < 1){
            return (<div>No results!</div>)
        }

        // var totalListHeight = this.state.entrySquareSize * this.state.cellContents.length
        var totalListHeight = this.state.cellContents.map((row,index)=>{
            if (row[0].date) { //header row
                return DAY_HEADER_HEIGHT
            } else { //photo row
                return this.state.entrySquareSize
            }
        }).reduce((a,b)=>(a+b),0)
        console.log(this.state.cellContents)

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



                <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
                  {({width}) => (
                    <Grid
                      ref={this.listRef}
                      onSectionRendered={({rowStartIndex})=>{
                        var date = this.state.cellContents[rowStartIndex][0].date
                        if (date) {
                            if (date=='No Timestamp') {
                                this.setState({
                                    currTopRenderedRowIdx:rowStartIndex,
                                    date:date,
                                    fromNow:date
                                })
                            } else {
                                this.setState({
                                    currTopRenderedRowIdx:rowStartIndex,
                                    date:moment(date).format("MMMM Do YYYY"),
                                    fromNow:moment(date).fromNow()
                                })
                            }
                        }
                      }}
                      overscanRowCount={5}
                      style={{outline:'none'}}
                      cellRenderer={this.cellRenderer}
                      onScroll={this.handleScroll}
                      columnWidth={this.state.entrySquareSize}
                      columnCount={this.state.numEntrySquaresPerRow}
                      height={this.state.height- topMenuHeight - 60}
                      estimatedRowSize={totalListHeight/this.state.cellContents.length.toFixed(1)}
                      rowHeight={({index})=> {
                        if (this.state.cellContents[index][0].date) { //header row
                            return DAY_HEADER_HEIGHT
                        } else { //photo row
                            return this.state.entrySquareSize
                        }
                      }}
                      rowCount={this.state.cellContents.length}
                      width={width}
                    />
                  )}
                </AutoSizer>

            { this.state.cellContents[this.state.currTopRenderedRowIdx][0] && (
                <div style={{
                    right:0,
                    top:topMenuHeight + 10+ (0 / totalListHeight) * (this.state.height - topMenuHeight - 50 - 20),
                    position:'fixed',
                    float:'left',
                    width:180,
                    padding:0,
                    height:50,
                    zIndex:100,
                }}>
                    <div style={{textAlign:'right',paddingRight:30}} className='handle'>
                        <b>{this.state.date}</b> <br/>
                    </div>
                    <div style={{textAlign:'right',paddingRight:30}}>
                        {this.state.fromNow}
                    </div>
                </div>
            )}

                <div style={{
                    backgroundColor:'white',
                    position:'fixed',
                    right:0,
                    top:topMenuHeight,
                    height:this.state.height-topMenuHeight,
                    width:timelineScrollWidth}}>
                        
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
                            var rowIdx = this.state.hash2row[this.props.idx2hash[nextIndex]]
                            this.listRef.current.scrollToCell({columnIndex:0,rowIndex:rowIdx})
                            this.getPhotoDetails(this.props.idx2hash[nextIndex])
                        }}
                        onMoveNextRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.props.idx2hash.length + 1) % this.props.idx2hash.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            var rowIdx = this.state.hash2row[this.props.idx2hash[nextIndex]]
                            this.listRef.current.scrollToCell({columnIndex:0,rowIndex:rowIdx})
                            this.getPhotoDetails(this.props.idx2hash[nextIndex])
                        }}/>
                }

            </div>
            
        )
    }
}




SearchMultipleCategories = connect((store)=>{
  return {
    searchingPhotos: store.search.searchingPhotos,
    searchedPhotos: store.search.searchedPhotos,
    searchPhotosRes: store.search.searchPhotosRes,
    searchPhotosResGroupedByDate: store.search.searchPhotosResGroupedByDate,

    searchingPeople: store.search.searchingPeople,
    searchedPeople: store.search.searchedPeople,
    searchPeopleRes: store.search.searchPeopleRes,

    searchingThingAlbums: store.search.searchingThingAlbums,
    searchedThingAlbums: store.search.searchedThingAlbums,
    searchThingAlbumsRes: store.search.searchThingAlbumsRes,
   
    searchingPlaceAlbums: store.search.searchingPlaceAlbums,
    searchedPlaceAlbums: store.search.searchedPlaceAlbums,
    searchPlaceAlbumsRes: store.search.searchPlaceAlbumsRes,

    query: store.search.query,

    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
    idx2hash: store.search.idx2hash,
    albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(SearchMultipleCategories)
