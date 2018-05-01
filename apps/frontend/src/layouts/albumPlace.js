import React, {Component} from 'react';
import { connect } from "react-redux";
import {AlbumDateCard, AlbumDateCardPlaceholder, AlbumDateCardPlain, AlbumDateCardPlainPlaceholder, AlbumAutoGallery} from '../components/album'
import {Container, Icon, Header, Button, Card, Loader, Label, Popup, Image, Divider, Grid as GridSUI} from 'semantic-ui-react'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'

import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';
import {AlbumAutoMonths} from './albumAutoMonths'
import {AlbumDateMonths} from './albumDateMonths'

import {fetchPlaceAlbumsList} from '../actions/albumsActions'
import ReactCSSTransitionGroup from 'react-transition-group/CSSTransitionGroup';
import {searchPhotos} from '../actions/searchActions'
import { push } from 'react-router-redux'
import store from '../store'
import { Grid, List, WindowScroller,AutoSizer } from 'react-virtualized';
import {AllPhotosMap, EventMap, LocationClusterMap} from '../components/maps'
import CountryPiChart from '../components/charts/countryPiChart'
import WordCloud from '../components/charts/wordCloud'

var topMenuHeight = 55 // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;

export class AlbumPlace extends Component {
  constructor() {
    super();
    this.state = {
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
    if (this.props.albumsPlaceList.length == 0){
      this.props.dispatch(fetchPlaceAlbumsList())
    }
  }


  calculateEntrySquareSize() {
  	if (window.innerWidth < 600) {
  		var numEntrySquaresPerRow = 2
  	} 
    else if (window.innerWidth < 800) {
      var numEntrySquaresPerRow = 3
    }
  	else if (window.innerWidth < 1000) {
  		var numEntrySquaresPerRow = 4
  	}
    else if (window.innerWidth < 1200) {
      var numEntrySquaresPerRow = 5
    }
  	else {
  		var numEntrySquaresPerRow = 6
  	}

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15

    var entrySquareSize = columnWidth / numEntrySquaresPerRow
    var numEntrySquaresPerRow = numEntrySquaresPerRow
  	this.setState({
      ...this.state,
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:entrySquareSize,
      numEntrySquaresPerRow:numEntrySquaresPerRow,
  	})
  }


  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
      var albumPlaceIndex = rowIndex * this.state.numEntrySquaresPerRow + columnIndex
      if (albumPlaceIndex < this.props.albumsPlaceList.length) {
        return (
          <div key={key} style={style}>
            <div 
              onClick={()=>{
                store.dispatch(searchPhotos(this.props.albumsPlaceList[albumPlaceIndex].title))
                store.dispatch(push('/search'))
              }}
              style={{padding:10}}>

            <Image.Group>
            {this.props.albumsPlaceList[albumPlaceIndex].cover_photo_urls.map((url)=>{
              return (
                <Image style={{display:'inline-block'}} 
                  width={this.state.entrySquareSize/2-20} 
                  height={this.state.entrySquareSize/2-20}
                  src={serverAddress+url}/>
              )
            })}
            </Image.Group>
            </div>
            <div style={{paddingLeft:15,paddingRight:15}}>
            <b>{this.props.albumsPlaceList[albumPlaceIndex].title}</b> {this.props.albumsPlaceList[albumPlaceIndex].photo_count}
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



	render () {
		var entrySquareSize = this.state.entrySquareSize
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow
    console.log(this.state.gridHeight)
		return (
      <div>
        <div style={{position:'fixed',top:topMenuHeight+22,right:5,float:'right'}}>
          <Button 
            active={this.state.showMap}
            compact 
            size='mini' 
            onClick={()=>{
              this.setState({
                showMap: !this.state.showMap,
                gridHeight: !this.state.showMap ? this.state.height - topMenuHeight - 260 : this.state.height - topMenuHeight - 60,
                headerHeight: !this.state.showMap ? 260 : 60
              })}
            }
            floated='right'>
              {this.state.showMap ? "Hide Map" : "Show Map"}
            </Button>
        </div>

        <div style={{height:this.state.headerHeight,paddingTop:10,paddingRight:5}}>

          <Header as='h2'>
            <Icon name='map outline' />
            <Header.Content>
              Places
              <Header.Subheader>
                Showing top {this.props.albumsPlaceList.length} places 
              </Header.Subheader>
            </Header.Content>
          </Header>
          
          {this.state.showMap && <LocationClusterMap height={200-20}/>}

        </div>
        <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
          {({width}) => (
            <Grid
              style={{outline:'none'}}
              disableHeader={false}
              cellRenderer={this.cellRenderer}
              columnWidth={this.state.entrySquareSize}
              columnCount={this.state.numEntrySquaresPerRow}
              height={this.state.gridHeight}
              rowHeight={this.state.entrySquareSize+50}
              rowCount={Math.ceil(this.props.albumsPlaceList.length/this.state.numEntrySquaresPerRow.toFixed(1))}
              width={width}
            />
          )}
        </AutoSizer>
      </div>
		)
	}
}

export class EntrySquare extends Component {
	render () {
    var images = this.props.coverPhotoUrls.map(function(coverPhotoUrl){
      return (
        <Image style={{display:'inline-block'}}
          width={this.props.size/2-20} 
          height={this.props.size/2-20}
          src={serverAddress+coverPhotoUrl}/>
      )
    },this)
		return (
			<div style={{
        width:this.props.size,
        display:'inline-block',
        paddingLeft:10,
        paddingRight:10}}
        onClick={()=>{
          store.dispatch(searchPhotos(this.props.title))
          store.dispatch(push('/search'))
        }}
        >
        <div style={{height:this.props.size}}>
          <LazyLoad
            once={true}
            unmountIfInvisible={true}
            height={this.props.size}>
            <Image.Group>
            {images}
            </Image.Group>
          </LazyLoad>
        </div>
				<div style={{height:100}}>
					<b>{this.props.title}</b> ({this.props.photoCount})
				</div>
			</div>
		)
	}
}


AlbumPlace = connect((store)=>{
  return {
    albumsPlaceList: store.albums.albumsPlaceList,
    fetchingAlbumsPlaceList: store.albums.fetchingAlbumsPlaceList,
    fetchedAlbumsPlaceList: store.albums.fetchedAlbumsPlaceList,
  }
})(AlbumPlace)