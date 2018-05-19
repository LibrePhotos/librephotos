import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums} from '../actions/albumsActions'
import {Container, Icon, Divider, Header, Image, Button, Card, Loader} from 'semantic-ui-react'
import { fetchPeople, fetchEgoGraph } from '../actions/peopleActions';
import { fetchPhotoDetail, fetchNoTimestampPhotoList} from '../actions/photosActions';

import {Server, serverAddress} from '../api_client/apiClient'
import { Grid, List, WindowScroller,AutoSizer } from 'react-virtualized';
import {EgoGraph} from '../components/egoGraph'
import { push } from 'react-router-redux'
import {LightBox} from '../components/lightBox'
import moment from 'moment'
import _ from 'lodash'

var topMenuHeight = 55 // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;
var DAY_HEADER_HEIGHT = 70
var leftMenuWidth = 85 // don't change this

var SIDEBAR_WIDTH = 85;

class DayGroupPlaceholder extends Component {
    render () {
        var numRows = Math.ceil(this.props.day.photos.length/this.props.numItemsPerRow.toFixed(1))
        var gridHeight = this.props.itemSize * numRows
        var photos = this.props.day.photos.map(function(photo) {
            return (
                <Image key={'daygroup_album_person_image_placeholder_'+photo.image_hash} style={{display:'inline-block',padding:1,margin:0}}
                    height={this.props.itemSize} 
                    width={this.props.itemSize} 
                    src={'/thumbnail_placeholder.png'}/>
            )
        },this)
        return (
            <div key={'daygroup_placeholder_album_person_'+this.props.day}>
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
        var photos = this.props.day.photos.map(function(photo,idx) {
            return (
                <Image key={'daygroup_album_person_image_'+photo.image_hash+idx} style={{display:'inline-block',padding:1,margin:0}}
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
            <div key={'daygroup_grid_album_person_'+this.props.day} style={{}}>
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


const calculateGridCells = (groupedByDateList,itemsPerRow) => {
  var gridContents = []
  var rowCursor = []

  groupedByDateList.forEach((day)=>{
    gridContents.push([day])
    day.photos.forEach((photo,idx)=>{
      if (idx ==0 ) {
        rowCursor = []
      }
      if (idx > 0 && idx % itemsPerRow == 0) {
        // console.log('pushing row cursor to grid contents', idx)
        gridContents.push(rowCursor)
      }
      if (idx % itemsPerRow == 0) {
        rowCursor = []
      }
      // console.log('pushing to row cursor', photo.image_hash)
      rowCursor.push(photo)

      if (idx == day.photos.length-1) {
        gridContents.push(rowCursor)        
      }

    })
  })
  console.log(gridContents)

}



export class AlbumPersonGallery extends Component {
    state = {
      photosGroupedByDate: [],
      idx2hash: [],
      lightboxImageIndex: 1,
      lightboxShow:false,
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:200,
      showGraph:false,
      gridHeight: window.innerHeight- topMenuHeight - 60,
      headerHeight: 60,
      currTopRenderedRowIdx:0,
      numEntrySquaresPerRow:2,
    }

  constructor() {
    super();
    this.listRef = React.createRef()
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
    this.cellRenderer = this.cellRenderer.bind(this)
    this.onPhotoClick = this.onPhotoClick.bind(this)
  }

  componentDidMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
    if (this.props.people.length == 0){
      this.props.dispatch(fetchPeopleAlbums(this.props.match.params.albumID))
    }
    this.props.dispatch(fetchEgoGraph(this.props.match.params.albumID))
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.calculateEntrySquareSize.bind(this))
  }


  calculateEntrySquareSize() {
    if (window.innerWidth < 600) {
      var numEntrySquaresPerRow = 2
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

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15

    var entrySquareSize = columnWidth / numEntrySquaresPerRow
    var numEntrySquaresPerRow = numEntrySquaresPerRow
    this.setState({
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:entrySquareSize,
      numEntrySquaresPerRow:numEntrySquaresPerRow
    })
    if (this.listRef.current) {
        this.listRef.current.recomputeRowHeights()
    }
  }

    onPhotoClick(hash) {
        this.setState({lightboxImageIndex:this.state.idx2hash.indexOf(hash),lightboxShow:true})
    }

 



    static getDerivedStateFromProps(nextProps,prevState){
      if (nextProps.albumsPeople.hasOwnProperty(nextProps.match.params.albumID)){
        const photos = nextProps.albumsPeople[nextProps.match.params.albumID].photos
        if (prevState.idx2hash.length != photos.length) {

            var t0 = performance.now();
            var groupedByDate = _.groupBy(photos,(el)=>{
                if (el.exif_timestamp) {
                    return moment(el.exif_timestamp).format('YYYY-MM-DD')
                } else {
                    return "No Timestamp"
                }
            })
            console.log(groupedByDate)
            var groupedByDateList = _.reverse(_.sortBy(_.toPairsIn(groupedByDate).map((el)=>{
                return {date:el[0],photos:el[1]}
            }),(el)=>el.date))

            var idx2hash = []
            groupedByDateList.forEach((g)=>{
                g.photos.forEach((p)=>{
                    idx2hash.push(p.image_hash)
                })
            })

            console.log(groupedByDateList)
            
            calculateGridCells(groupedByDateList,prevState.numEntrySquaresPerRow)
            var t1 = performance.now();
            console.log(t1-t0)



            return {
                ...prevState, 
                photosGroupedByDate: groupedByDateList,
                idx2hash:idx2hash
            }
        } else {
          return null
        }
      } else {
        return null
      }
    }






    rowRenderer = ({index, isScrolling, key, style}) => {
        const {isScrollingFast} = this.state;
        var rowHeight = this.state.entrySquareSize * Math.ceil(this.state.photosGroupedByDate[index].photos.length/this.state.numEntrySquaresPerRow.toFixed(1)) + DAY_HEADER_HEIGHT
        if (isScrollingFast) {
            return (
                <div key={key} style={{...style,height:rowHeight}}>
                    <div style={{backgroundColor:'white'}}>
                    <DayGroupPlaceholder
                        key={index}
                        onPhotoClick={this.onPhotoClick}
                        day={this.state.photosGroupedByDate[index]} 
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
                        day={this.state.photosGroupedByDate[index]} 
                        itemSize={this.state.entrySquareSize} 
                        numItemsPerRow={this.state.numEntrySquaresPerRow}/>
                    </div>
                </div>
            )        }
    }

    getRowHeight = ({index}) => {
        var rowHeight = this.state.entrySquareSize * Math.ceil(this.state.photosGroupedByDate[index].photos.length/this.state.numEntrySquaresPerRow.toFixed(1)) + DAY_HEADER_HEIGHT
        return (
            rowHeight
        )
    }






  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
      var photoIndex = rowIndex * this.state.numEntrySquaresPerRow + columnIndex
      if (photoIndex < this.props.albumsPeople[this.props.match.params.albumID].photos.length) {
      	var image_url = this.props.albumsPeople[this.props.match.params.albumID].photos[photoIndex].square_thumbnail
        return (
          <div key={key} style={style}>
            <div 
              onClick={()=>{
                this.onPhotoClick(photoIndex)
                console.log('clicked')
                // this.props.dispatch(push(`/person/${this.props.albumsPeople[this.props.match.params.albumID][photoIndex].key}`))
              }}>
              <Image 
              	height={this.state.entrySquareSize-5}
              	width={this.state.entrySquareSize-5}
              	src={serverAddress+image_url}/>

            </div>
          </div>
        )
      }
      else {
        return (
          <div key={key} style={style}>
          </div>
        )
      }
  }
  
  getPhotoDetails(image_hash) {
      if (!this.props.photoDetails.hasOwnProperty(image_hash)) {
          this.props.dispatch(fetchPhotoDetail(image_hash))
      }
  }

  render() {
    var entrySquareSize = this.state.entrySquareSize
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow
    if (this.props.albumsPeople.hasOwnProperty(this.props.match.params.albumID)) {
        var totalListHeight = this.state.photosGroupedByDate.map((day,index)=>{
            return (
                this.getRowHeight({index})
            )
        }).reduce((a,b)=>(a+b),0)
        console.log('totalListHeight: ',totalListHeight)
        console.log('first row height: ',this.getRowHeight({index:0}))
	    return (
	      <div>

          <div style={{position:'fixed',top:topMenuHeight+22,right:5,float:'right'}}>
            <Button 
              active={this.state.showGraph}
              compact 
              size='mini' 
              onClick={()=>{
                this.setState({
                  showGraph: !this.state.showGraph,
                  gridHeight: !this.state.showGraph ? this.state.height - topMenuHeight - 260 : this.state.height - topMenuHeight - 60,
                  headerHeight: !this.state.showGraph ? 260 : 60
                })}
              }
              floated='right'>
                {this.state.showGraph ? "Hide Graph" : "Show Graph"}
              </Button>
          </div>



	      	<div style={{height:this.state.headerHeight,paddingTop:10,paddingRight:5}}>


            <Header as='h2'>
              <Icon name='user circle' />
              <Header.Content>
              	{this.props.albumsPeople[this.props.match.params.albumID].name}
                <Header.Subheader>
          	      {this.props.albumsPeople[this.props.match.params.albumID].photos.length} Photos
                </Header.Subheader>
              </Header.Content>
            </Header>


            {this.state.showGraph && <EgoGraph height={200-20} width={this.state.width-SIDEBAR_WIDTH-12 } person_id={this.props.match.params.albumID}/>}


	      	</div>

                    <List
                        ref={this.listRef}
                        style={{outline:'none',paddingRight:0,marginRight:0}}
                        onRowsRendered={({ overscanStartIndex, overscanStopIndex, startIndex, stopIndex })=>{
                            this.setState({currTopRenderedRowIdx:startIndex})
                        }}
                        height={this.state.gridHeight}
                        overscanRowCount={5}
                        rowCount={this.state.photosGroupedByDate.length}
                        rowHeight={this.getRowHeight}
                        rowRenderer={this.rowRenderer}
                        onScroll={this.handleScroll}
                        estimatedRowSize={totalListHeight/this.state.photosGroupedByDate.length.toFixed(10)}
                        width={this.state.width-leftMenuWidth-5}/>

          { this.state.lightboxShow &&
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
    else {
    	return (
    		<div><Loader active/></div>
    	)
    }
  }
}


AlbumPersonGallery = connect((store)=>{
  return {
    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
    people: store.people.people,
    fetchedPeople: store.people.fetched,
    fetchingPeople: store.people.fetching,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
  }
})(AlbumPersonGallery)
