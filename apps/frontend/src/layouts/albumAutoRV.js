import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums, fetchAutoAlbumsList} from '../actions/albumsActions'
import {AlbumAutoCard, AlbumAutoGallery} from '../components/album'
import {Container, Icon, Header, Image, Button, Card, Label, Popup} from 'semantic-ui-react'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'
import { Grid, List, WindowScroller,AutoSizer } from 'react-virtualized';
import {Server, serverAddress} from '../api_client/apiClient'


var topMenuHeight = 55 // don't change this
var leftMenuWidth = 85 // don't change this
var SIDEBAR_WIDTH = 85
var timelineScrollWidth = 0
var DAY_HEADER_HEIGHT = 35

export class AlbumAutoRV extends Component {
    constructor(props){
      super(props)
      this.cellRenderer = this.cellRenderer.bind(this)
      this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
      this.state = {
        scrollToIndex: undefined,
        width:  window.innerWidth,
        height: window.innerHeight,
        entrySquareSize:200,
        currTopRenderedCellIdx:0
      }
    }


  componentWillMount() {
    this.props.dispatch(fetchAutoAlbumsList())
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
  }


  calculateEntrySquareSize() {
  	if (window.innerWidth < 400) {
  			var numEntrySquaresPerRow = 1
  	}
    else if (window.innerWidth < 600) {
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
      var albumAutoIndex = rowIndex * this.state.numEntrySquaresPerRow + columnIndex
      if (albumAutoIndex < this.props.albumsAutoList.length) {
	      return (
	      	<div key={key} style={style}>
	      		<div style={{padding:10}}>
	      		<Image 
	      			height={this.props.entrySquareSize}
	      			width={this.props.entrySquareSize}
		      		src={serverAddress + '/media/square_thumbnails/'+this.props.albumsAutoList[albumAutoIndex].photos[0]+'.jpg'}/>
	      		</div>

	      		<div style={{paddingLeft:15,paddingRight:30}}>






	      		<Header style={{marginBottom:5}} as='h3'>
              {this.props.albumsAutoList[albumAutoIndex].timestamp.split('T')[0]}
            </Header>
	      		<b>{this.props.albumsAutoList[albumAutoIndex].title}</b>
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

  render() {

    return (
      <div>

        <div style={{height:60,paddingTop:10}}>


          <Header as='h2'>
            <Icon name='users' />
            <Header.Content>
              Events
              <Header.Subheader>
                {this.props.albumsAutoList.length} Events
              </Header.Subheader>
            </Header.Content>
          </Header>



        </div>

        <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
          {({width}) => (
            <Grid
            	style={{outline:'none'}}
            	headerHeight={100}
            	disableHeader={false}
              cellRenderer={this.cellRenderer}
              columnWidth={this.state.entrySquareSize}
              columnCount={this.state.numEntrySquaresPerRow}
              height={this.state.height- topMenuHeight -60}
              rowHeight={this.state.entrySquareSize+120}
              rowCount={Math.ceil(this.props.albumsAutoList.length/this.state.numEntrySquaresPerRow.toFixed(1))}
              width={width}
            />
          )}
        </AutoSizer>
      </div>
    )
  }
}





AlbumAutoRV = connect((store)=>{
  return {
    albumsAuto: store.albums.albumsAuto,
    fetchingAlbumsAuto: store.albums.fetchingAlbumsAuto,
    fetchedAlbumsAuto: store.albums.fetchedAlbumsAuto,
    
    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,

    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    generatedAlbumsAuto: store.albums.generatedAlbumsAuto,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    statusPhotoScan: store.util.statusPhotoScan,
    scanningPhotos: store.photos.scanningPhotos,

  }
})(AlbumAutoRV)
