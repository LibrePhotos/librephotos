import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums} from '../actions/albumsActions'
import {Container, Icon, Divider, Header, Image, Button, Card, Loader} from 'semantic-ui-react'
import { fetchPeople, fetchEgoGraph } from '../actions/peopleActions';

import {Server, serverAddress} from '../api_client/apiClient'
import { Grid, List, WindowScroller,AutoSizer } from 'react-virtualized';
import {EgoGraph} from '../components/egoGraph'
import { push } from 'react-router-redux'

var topMenuHeight = 55 // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;




export class AlbumPersonGallery extends Component {

  constructor() {
    super();
    this.state = {
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:200,
      showGraph:false,
      gridHeight: window.innerHeight- topMenuHeight - 60,
      headerHeight: 60
    }
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
    this.cellRenderer = this.cellRenderer.bind(this)
  }

  componentWillMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
    if (this.props.people.length == 0){
      this.props.dispatch(fetchPeopleAlbums(this.props.match.params.albumID))
    }
    this.props.dispatch(fetchEgoGraph(this.props.match.params.albumID))
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

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
      var photoIndex = rowIndex * this.state.numEntrySquaresPerRow + columnIndex
      if (photoIndex < this.props.albumsPeople[this.props.match.params.albumID].photos.length) {
      	var image_url = this.props.albumsPeople[this.props.match.params.albumID].photos[photoIndex].square_thumbnail
        return (
          <div key={key} style={style}>
            <div 
              onClick={()=>{
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

  render() {
  	console.log(this.props.match)
    var entrySquareSize = this.state.entrySquareSize
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow
    if (this.props.albumsPeople.hasOwnProperty(this.props.match.params.albumID)) {
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
	        <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
	          {({width}) => (
	            <Grid
	              style={{outline:'none'}}
	              cellRenderer={this.cellRenderer}
	              columnWidth={this.state.entrySquareSize}
	              columnCount={this.state.numEntrySquaresPerRow}
	              height={this.state.gridHeight}
	              rowHeight={this.state.entrySquareSize}
	              rowCount={Math.ceil(this.props.albumsPeople[this.props.match.params.albumID].photos.length/this.state.numEntrySquaresPerRow.toFixed(1))}
	              width={width}
	            />
	          )}
	        </AutoSizer>	      
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
  }
})(AlbumPersonGallery)