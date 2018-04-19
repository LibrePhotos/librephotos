import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums, fetchDateAlbumsList} from '../actions/albumsActions'
import {AlbumDateCard, AlbumDateCardPlaceholder, AlbumDateCardPlain, AlbumDateCardPlainPlaceholder, AlbumAutoGallery} from '../components/album'
import {Container, Icon, Header, Button, Card, Label, Popup, Image, Divider} from 'semantic-ui-react'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'

import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';


var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;

export class Albums extends Component {
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
  }

  calculateEntrySquareSize() {
  	if (window.innerWidth < 600) {
  		var numEntrySquaresPerRow = 2
  	} 
  	else if (window.innerWidth < 1000) {
  		var numEntrySquaresPerRow = 4
  	}
  	else {
  		var numEntrySquaresPerRow = 6
  	}

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15

    console.log(columnWidth)
    var entrySquareSize = columnWidth / numEntrySquaresPerRow

  	this.setState({
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:entrySquareSize
  	})
  }


	render () {
		var entrySquareSize = this.state.entrySquareSize
		return (
				<div>
				<EntrySquare size={entrySquareSize} title='People'/>
				<EntrySquare size={entrySquareSize} title='People'/>
				<EntrySquare size={entrySquareSize} title='People'/>
				<EntrySquare size={entrySquareSize} title='People'/>
				<EntrySquare size={entrySquareSize} title='People'/>
				<EntrySquare size={entrySquareSize} title='People'/>
				</div>
		)
	}
}

export class EntrySquare extends Component {
	render () {
		return (
			<div style={{width:this.props.size,float:'left',paddingLeft:10,paddingRight:10}}>
				<Image 
					width={this.props.size-20} 
					height={this.props.size-20}
					src={'/thumbnail_placeholder.png'}/>
				<div style={{paddingTop:10,paddingBottom:20}}>
					{this.props.title}
				</div>
			</div>
		)
	}
}