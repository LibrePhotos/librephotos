import React, { Component } from 'react';
import { connect } from "react-redux";
import { Input, Button, Icon, Menu, Header, Divider, Image, Modal, Container} from 'semantic-ui-react'

import {searchPhotos} from '../actions/searchActions'
import LazyLoad from 'react-lazyload';
import {Server, serverAddress} from '../api_client/apiClient'

import {ModalPhotoViewVertical} from '../components/modalPhotoView';

var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;



function calculatePhotoResHeight(numPhotos) {
  if (window.innerWidth < 500) {
    var width = 450
  } else {
    var width = window.innerWidth-100
  }

  var photoSize = 107
  var columnWidth = width - 120
  
  var spacePerRow = Math.floor(columnWidth / photoSize)
  if (spacePerRow >= numPhotos) {
    var numRows = 1
    var numCols = numPhotos
  }
  else {
    var numRows = Math.ceil( numPhotos / spacePerRow )
    var numCols = spacePerRow
  }

  return numRows * photoSize
}

class PhotoResPlaceholder extends Component {
  constructor() {
    super();
    this.state = {
      width:  800,
      height: 182
    }
    this.calculatePlaceholderSize = this.calculatePlaceholderSize.bind(this)
  }

  /**
   * Calculate & Update state of new dimensions
   */
  updateDimensions() {
    if(window.innerWidth < 500) {
      this.setState({ width: 450, height: 102 });
    } else {
      let update_width  = window.innerWidth-100;
      let update_height = Math.round(update_width/4.4);
      this.setState({ width: update_width, height: update_height });
    }
  }

  /**
   * Add event listener
   */
  componentDidMount() {
    this.updateDimensions();
    window.addEventListener("resize", this.updateDimensions.bind(this));
  }

  /**
   * Remove event listener
  componentWillUnmount() {
    window.removeEventListener("resize", this.updateDimensions.bind(this));
  }
   */

  calculatePlaceholderSize() {
    var numPhotos = this.props.numPhotos
    var photoSize = 107
    var columnWidth = this.state.width - 120
    
    var spacePerRow = Math.floor(columnWidth / photoSize)
    if (spacePerRow >= numPhotos) {
      var numRows = 1
      var numCols = numPhotos
    }
    else {
      var numRows = Math.ceil( numPhotos / spacePerRow )
      var numCols = spacePerRow
    }


    var boxHeight = numRows * photoSize
    var boxWidth = numCols * photoSize

    return {height:boxHeight,width:boxWidth}
  }

  render() {
    var size = this.calculatePlaceholderSize()
    var h = `${size.height}px`
    var w = `${size.width}px`

    return (
      <div style={{textAlign:'center', verticalAlign:'center', height:h, width:w, backgroundColor:'#dddddd'}}>
      </div>
    )
  }
}

export class SearchBar extends Component {
	constructor(props) {
		super(props)
		this.handleSearch = this.handleSearch.bind(this)
		this.handleChange = this.handleChange.bind(this)
    this._handleKeyDown = this._handleKeyDown.bind(this)
	}

	componentWillMount() {
		this.setState({text:''})
    document.addEventListener("keydown", this._handleKeyDown.bind(this));
	}

  componentWillUnmount() {
    document.removeEventListener("keydown", this._handleKeyDown.bind(this));
  }

  _handleKeyDown (event) {
      switch( event.keyCode ) {
          case ENTER_KEY:
              this.props.dispatch(searchPhotos(this.state.text))
              break;
          default: 
              break;
      }
  }


	handleSearch(e,d) {
		this.props.dispatch(searchPhotos(this.state.text))
	}

	handleChange(e,d) {
		this.state.text = d.value
	}

	render() {
		return (
      <div style={{textAlign:'center'}}>
  		  <Input
  		  	onChange={this.handleChange}
  		  	loading={this.props.searchingPhotos}
  		    icon={{ name: 'search', circular: true, link: true, onClick: this.handleSearch}}
  		    placeholder='Search...'/>
      </div>
		)
	}
}

export class PhotoSearchResult extends Component {

  constructor(props) {
    super(props)
    this.onPhotoClick = this.onPhotoClick.bind(this)
    this._handleKeyDown = this._handleKeyDown.bind(this)

  }

  componentWillMount() {
    this.setState({
      showModal:false,
      modalPhotoIndex:0
    })
    document.addEventListener("keydown", this._handleKeyDown.bind(this));
  }

  componentWillUnmount() {
    document.removeEventListener("keydown", this._handleKeyDown.bind(this));
  }

  onPhotoClick(idx) {
    this.setState({showModal:true,modalPhotoIndex:idx})
  }

  _handleKeyDown (event) {
      switch( event.keyCode ) {
          case ESCAPE_KEY:
              if (this.refs.photoSearchResultRef) {
                this.setState({showModal:false});              
              } 
              break;
          case RIGHT_ARROW_KEY:
              if (this.state.modalPhotoIndex < this.props.searchPhotosRes.length-1) {
                if (this.refs.photoSearchResultRef) {
                  this.setState({modalPhotoIndex:this.state.modalPhotoIndex+1})                  
                }
              }
              break;
          case LEFT_ARROW_KEY:
              if (this.state.modalPhotoIndex > 0) {
                if (this.refs.photoSearchResultRef) {
                  this.setState({modalPhotoIndex:this.state.modalPhotoIndex-1})
                }
              }
              break;
          default: 
              break;
      }
  }



	render() {
		var images = this.props.searchPhotosRes.map(function(image,index){
			return (
	      <LazyLoad 
	        debounce={300}
	        height={100} 
	        placeholder={
	          <Image 
	            height={100} 
	            width={100} 
	            src={'/thumbnail_placeholder.png'}/>
	          }
	        >


  	        <Image 
              onClick={(e)=>{this.onPhotoClick(index)}}
              height={100} 
              width={100} 
              src={serverAddress+image.square_thumbnail_url}/>



	      </LazyLoad>
			)
		},this)


		return (
			<div ref="photoSearchResultRef">

        <Header as='h3'>
          Search results for "<i>{this.props.query}</i>"
        </Header>

				<Header as='h4'>
					<Header.Content>
						Photos
						<Header.Subheader>
							{this.props.searchPhotosRes.length} Results
						</Header.Subheader>
					</Header.Content>
				</Header>
				<Image.Group>
				{images}
				</Image.Group>
        <Modal 
          basic
          size='fullscreen'
          open={this.state.showModal}
          onClose={(e)=>{this.setState({showModal:false})}}>
          <Modal.Header as={'h5'} style={{textAlign:'center'}}>
          Search: <b>{this.props.query}</b> - ({this.state.modalPhotoIndex+1}/{this.props.searchPhotosRes.length})
          </Modal.Header>

          <ModalPhotoViewVertical 
            open={this.state.showModal} 
            photos={this.props.searchPhotosRes} 
            idx={this.state.modalPhotoIndex} />
        </Modal>
			</div>
		)
	}
}




export class SearchView extends Component {
	render() {
		return (
			<div style={{padding:20}}>
				<PhotoSearchResult/>
			</div>
		)
	}
}




SearchBar = connect((store)=>{
  return {
  	searchingPhotos: store.search.searchingPhotos,
  	searchedPhotos: store.search.searchedPhotos,
  	searchPhotosRes: store.search.searchPhotosRes
  }
})(SearchBar)

SearchView = connect((store)=>{
  return {
  	searchingPhotos: store.search.searchingPhotos,
  	searchedPhotos: store.search.searchedPhotos,
  	searchPhotosRes: store.search.searchPhotosRes
  }
})(SearchView)

PhotoSearchResult = connect((store)=>{
  return {
  	searchingPhotos: store.search.searchingPhotos,
  	searchedPhotos: store.search.searchedPhotos,
  	searchPhotosRes: store.search.searchPhotosRes,
    query: store.search.query
  }
})(PhotoSearchResult)
