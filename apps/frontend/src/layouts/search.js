import React, { Component } from 'react';
import { connect } from "react-redux";
import { Input, Button, Icon, Menu, Header, Divider, Image} from 'semantic-ui-react'

import {searchPhotos} from '../actions/searchActions'
import LazyLoad from 'react-lazyload';
import {Server, serverAddress} from '../api_client/apiClient'

import ModalPhotoViewVertical from '../components/modalPhotoView';

function calculatePhotoResHeight(numPhotos) {
  if (window.innerWidth < 500) {
    var width = 450
  } else {
    var width = window.innerWidth-100
  }

  var photoSize = 157
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
    var photoSize = 157
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
	}

	componentWillMount() {
		this.setState({text:''})
	}

	handleSearch(e,d) {
		console.log(this.state.text)
		this.props.dispatch(searchPhotos(this.state.text))
	}

	handleChange(e,d) {
		this.state.text = d.value
	}

	render() {
		return (
		  <Input
		  	onChange={this.handleChange}
		  	loading={this.props.searchingPhotos}
		  	fluid
		    icon={{ name: 'search', circular: true, link: true, onClick: this.handleSearch}}
		    placeholder='Search...'/>
		)
	}
}

export class PhotoSearchResult extends Component {

  constructor() {
    super();
    this.state = {
      modalShow:false,
      idx:0
    }
  }


	render() {
		var images = this.props.searchPhotosRes.map(function(image){
			return (
	      <LazyLoad 
	        debounce={300}
	        height={150} 
	        placeholder={
	          <Image 
	            height={150} 
	            width={150} 
	            src={'/thumbnail_placeholder.png'}/>
	          }
	        >
	        <Image height={150} width={150} src={serverAddress+image.square_thumbnail_url}/>
	      </LazyLoad>
        <ModalPhotoViewVertical photos={images} idx={this.state.idx}/>
			)
		})


		return (
			<div>
				<Header>
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
			</div>
		)
	}
}

export class SearchView extends Component {
	render() {
		return (
			<div>
				<SearchBar/>
				<Divider hidden/>
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
  	searchPhotosRes: store.search.searchPhotosRes
  }
})(PhotoSearchResult)
