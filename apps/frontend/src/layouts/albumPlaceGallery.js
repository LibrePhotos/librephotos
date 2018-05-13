import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPlaceAlbum, fetchAutoAlbums, generateAutoAlbums} from '../actions/albumsActions'
import {Container, Icon, Divider, Header, Image, Button, Flag, Card, Loader} from 'semantic-ui-react'
import { fetchPeople, fetchEgoGraph } from '../actions/peopleActions';
import { fetchPhotoDetail, fetchNoTimestampPhotoList} from '../actions/photosActions';

import {Server, serverAddress} from '../api_client/apiClient'
import { Grid, List, WindowScroller,AutoSizer } from 'react-virtualized';
import {EgoGraph} from '../components/egoGraph'
import { push } from 'react-router-redux'
import {countryNames} from '../util/countryNames'
import {AllPhotosMap, EventMap, LocationClusterMap, LocationMap} from '../components/maps'
import {LightBox} from '../components/lightBox'

import _ from 'lodash'


var topMenuHeight = 55 // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;




export class AlbumPlaceGallery extends Component {

  constructor() {
    super();
    this.state = {
      idx2hash: [],
      lightboxImageIndex: 1,
      lightboxShow:false,
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:200,
      showMap:false,
      gridHeight: window.innerHeight- topMenuHeight - 60,
      headerHeight: 60
    }
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
    this.cellRenderer = this.cellRenderer.bind(this)
  }

  componentWillMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
    this.props.dispatch(fetchPlaceAlbum(this.props.match.params.albumID))
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
      var numEntrySquaresPerRow = 8
    }
    else {
      var numEntrySquaresPerRow = 10
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
  }

  onPhotoClick(idx) {
      if (this.state.idx2hash.length != this.props.albumsPlace[this.props.match.params.albumID].photos.length) {
          this.setState({idx2hash:this.props.albumsPlace[this.props.match.params.albumID].photos.map((el)=>el.image_hash)})
      }
      this.setState({lightboxImageIndex:idx,lightboxShow:true})

  }


  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
      var photoIndex = rowIndex * this.state.numEntrySquaresPerRow + columnIndex
      if (photoIndex < this.props.albumsPlace[this.props.match.params.albumID].photos.length) {
      	var image_hash = this.props.albumsPlace[this.props.match.params.albumID].photos[photoIndex].image_hash
        return (
          <div key={key} style={style}>
            <div 
              onClick={()=>{
                this.onPhotoClick(photoIndex)
                console.log('clicked')
                // this.props.dispatch(push(`/person/${this.props.albumsPlace[this.props.match.params.albumID][photoIndex].key}`))
              }}>
              <Image 
              	height={this.state.entrySquareSize-5}
              	width={this.state.entrySquareSize-5}
              	src={serverAddress+'/media/square_thumbnails/'+image_hash+'.jpg'}/>

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
  	console.log(this.props.match)
    var entrySquareSize = this.state.entrySquareSize
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow
    if (this.props.albumsPlace.hasOwnProperty(this.props.match.params.albumID)) {
	    return (
	      <div>

          <div style={{position:'fixed',top:topMenuHeight+10,right:10,float:'right'}}>
            <Button 
              active={this.state.showMap}
              color='blue'
              icon labelPosition='right'
              onClick={()=>{
                this.setState({
                  showMap: !this.state.showMap,
                  gridHeight: !this.state.showMap ? this.state.height - topMenuHeight - 260 : this.state.height - topMenuHeight - 60,
                  headerHeight: !this.state.showMap ? 260 : 60
                })}
              }
              floated='right'>
                <Icon name='map' inverted/>{this.state.showMap ? "Hide Map" : "Show Map"}
              </Button>
          </div>



	      	<div style={{height:this.state.headerHeight,paddingTop:10,paddingRight:5}}>


            <Header as='h2'>
              <Icon name='map pin' />
              <Header.Content>
                {this.props.albumsPlace[this.props.match.params.albumID].title} 
                {countryNames.includes(this.props.albumsPlace[this.props.match.params.albumID].title.toLowerCase()) && <Flag style={{paddingLeft:10}} name={this.props.albumsPlace[this.props.match.params.albumID].title.toLowerCase()}/>}
                <Header.Subheader>
          	      {this.props.albumsPlace[this.props.match.params.albumID].photos.length} Photos
                </Header.Subheader>
              </Header.Content>
            </Header>


          {this.state.showMap && <LocationMap zoom={4} photos={_.sampleSize(this.props.albumsPlace[this.props.match.params.albumID].photos,100)} height={200-20}/>}


	      	</div>
	        <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
	          {({width}) => (
	            <Grid
	              style={{outline:'none'}}
	              cellRenderer={this.cellRenderer}
	              columnWidth={this.state.entrySquareSize}
	              columnCount={this.state.numEntrySquaresPerRow}
	              height={this.state.gridHeight}
	              rowHeight={this.state.entrySquareSize}
	              rowCount={Math.ceil(this.props.albumsPlace[this.props.match.params.albumID].photos.length/this.state.numEntrySquaresPerRow.toFixed(1))}
	              width={width}
	            />
	          )}
	        </AutoSizer>	      

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


AlbumPlaceGallery = connect((store)=>{
  return {
    albumsPlace: store.albums.albumsPlace,
    fetchingAlbumsPlace: store.albums.fetchingAlbumsPlace,
    fetchedAlbumsPlace: store.albums.fetchedAlbumsPlace,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
  }
})(AlbumPlaceGallery)