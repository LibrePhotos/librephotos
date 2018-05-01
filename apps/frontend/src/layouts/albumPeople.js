import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums} from '../actions/albumsActions'
import {AlbumPeopleCard, AlbumPeopleGallery} from '../components/album'
import {Container, Icon, Divider, Header, Image, Button, Card} from 'semantic-ui-react'
import { fetchPeople } from '../actions/peopleActions';

import {Server, serverAddress} from '../api_client/apiClient'
import { Grid, List, WindowScroller,AutoSizer } from 'react-virtualized';

import { push } from 'react-router-redux'

var topMenuHeight = 55 // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;


export class AlbumPeople extends Component {

  constructor() {
    super();
    this.setState({
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:200
    })
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
    this.cellRenderer = this.cellRenderer.bind(this)
  }

  componentWillMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
    if (this.props.people.length == 0){
      this.props.dispatch(fetchPeople())
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
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:entrySquareSize,
      numEntrySquaresPerRow:numEntrySquaresPerRow
    })
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
      var albumPlaceIndex = rowIndex * this.state.numEntrySquaresPerRow + columnIndex
      if (albumPlaceIndex < this.props.people.length) {
        return (
          <div key={key} style={style}>
            <div 
              onClick={()=>{
                console.log('clicked')
                if (!this.props.albumsPeople.hasOwnProperty(this.props.people[albumPlaceIndex].key)){
                  this.props.dispatch(fetchPeopleAlbums(this.props.people[albumPlaceIndex].key))
                }
                this.props.dispatch(push(`/person/${this.props.people[albumPlaceIndex].key}`))
              }}
              style={{paddingLeft:10,paddingBottom:10}}>

              <Image 
                style={{padding:5}}
                src={serverAddress+this.props.people[albumPlaceIndex].face_photo_url}/>

            </div>
            <div style={{paddingLeft:15,paddingRight:10}}>
            <b>{this.props.people[albumPlaceIndex].text}</b> {this.props.people[albumPlaceIndex].face_count}
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
    var entrySquareSize = this.state.entrySquareSize
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow
    return (
      <div>


        <div style={{height:60,paddingTop:10}}>


          <Header as='h2'>
            <Icon name='users' />
            <Header.Content>
              People
              <Header.Subheader>
                {this.props.people.length} People
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
              rowHeight={this.state.entrySquareSize+30}
              rowCount={Math.ceil(this.props.people.length/this.state.numEntrySquaresPerRow.toFixed(1))}
              width={width}
            />
          )}
        </AutoSizer>
      </div>
    )
  }
}


AlbumPeople = connect((store)=>{
  return {
    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
    people: store.people.people,
    fetchedPeople: store.people.fetched,
    fetchingPeople: store.people.fetching,
  }
})(AlbumPeople)