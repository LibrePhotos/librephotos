import React, {Component} from 'react';
import { connect } from "react-redux";
import {AlbumDateCard, AlbumDateCardPlaceholder, AlbumDateCardPlain, AlbumDateCardPlainPlaceholder, AlbumAutoGallery} from '../components/album'
import {Container, Icon, Header, Button, Card, Loader, Label, Popup, Image, Divider} from 'semantic-ui-react'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'

import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';
import {AlbumAutoMonths} from './albumAutoMonths'
import {AlbumDateMonths} from './albumDateMonths'

import {fetchThingAlbumsList} from '../actions/albumsActions'
import ReactCSSTransitionGroup from 'react-transition-group/CSSTransitionGroup';

var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;

export class AlbumThing extends Component {
  constructor() {
    super();
  	this.setState({
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:200
  	})
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
  }

  componentWillMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
    if (this.props.albumsThingList.length == 0){
      this.props.dispatch(fetchThingAlbumsList())
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

    console.log(columnWidth)
    var entrySquareSize = columnWidth / numEntrySquaresPerRow
    var numEntrySquaresPerRow = numEntrySquaresPerRow
  	this.setState({
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:entrySquareSize,
      numEntrySquaresPerRow:numEntrySquaresPerRow
  	})
  }

	render () {
		var entrySquareSize = this.state.entrySquareSize
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow
    if (this.props.fetchedAlbumsThingList) {

      // only show things with photo counts greater than 10
      var albumsThingList = this.props.albumsThingList.filter(function(thing){
        if (thing.photo_count >= 4) {
          return true
        }
        else {
          return false
        }

      })

      var toRender = albumsThingList.map(function(thing){
        return (
          <EntrySquare 
            size={this.state.entrySquareSize} 
            coverPhotoUrls={thing.cover_photo_urls}
            title={thing.title}/>
        )
      },this)
    }
    else {
      var toRender = <Loader active/>
    }
		return (
				<div>
        <div>
        {toRender}
        </div>
        <Divider/>

				</div>
		)
	}
}

export class EntrySquare extends Component {
	render () {
    var images = this.props.coverPhotoUrls.map(function(coverPhotoUrl){
      return (
      <ReactCSSTransitionGroup
        transitionName="example"
        transitionAppear={true}
        transitionAppearTimeout={500}
        transitionEnterTimeout={500}
        transitionLeaveTimeout={300}>
        <Image 
          width={this.props.size/2-20} 
          height={this.props.size/2-20}
          src={serverAddress+coverPhotoUrl}/>
      </ReactCSSTransitionGroup>
      )
    },this)
		return (
			<div style={{
        width:this.props.size,
        display:'inline-block',
        paddingLeft:10,
        paddingRight:10}}>
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
				<div style={{marginTop:-30,paddingBottom:20}}>
					<b>{this.props.title}</b>
				</div>
			</div>
		)
	}
}


AlbumThing = connect((store)=>{
  return {
    albumsThingList: store.albums.albumsThingList,
    fetchingAlbumsThingList: store.albums.fetchingAlbumsThingList,
    fetchedAlbumsThingList: store.albums.fetchedAlbumsThingList,
  }
})(AlbumThing)