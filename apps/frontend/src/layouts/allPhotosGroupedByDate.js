import React, { Component } from 'react';
import { Image, Header, Loader, Dimmer } from 'semantic-ui-react';
import { connect } from "react-redux";
import { simpleFetchPhotos } from '../actions/photosActions'
import { serverAddress } from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';


        // <div style={{
        //     display: "block",
        //     minHeight: "1px",
        //     width: "100%",
        //     padding: '10px',
        //     overflowX: "hidden",
        //     overflowY: 'auto'}}>
        //   <Gallery 
        //     images={mappedRenderablePhotoArray}
        //     enableImageSelection={false}
        //     rowHeight={250}/>
        // </div>
var SIDEBAR_WIDTH = 85;

class ImagePlaceholder extends Component {
  render () {
    return (
      <div style={{height:this.props.size,width:this.props.size}}>
      </div>
    )
  }
}

export class AllPhotosGroupedByDate extends Component {
  constructor(props){
    super(props)
    this.groupPhotosByDate = this.groupPhotosByDate.bind(this)
    this.receivedAllProps = this.receivedAllProps.bind(this)
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
    this.groupedPhotosToImageGrids = this.groupedPhotosToImageGrids.bind(this)
  	this.setState({
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:200
  	})
  } 

  calculateEntrySquareSize() {
  	if (window.innerWidth < 600) {
  		var numEntrySquaresPerRow = 4
  	} 
    else if (window.innerWidth < 800) {
      var numEntrySquaresPerRow = 6
    }
  	else if (window.innerWidth < 1000) {
  		var numEntrySquaresPerRow = 8
  	}
    else if (window.innerWidth < 1200) {
      var numEntrySquaresPerRow = 10
    }
  	else {
  		var numEntrySquaresPerRow = 12
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

  receivedAllProps() {
    if (this.props.fetchedPhotos && 
        !this.props.photos.length==0 && 
        !this.props.fetchingPhotos &&
        this.props.fetchedPhotos) {

      console.log("fetchedPhotos",this.props.fetchedPhotos)
      console.log("photos",this.props.photos.length)
      console.log("fetchingPhotos",this.props.fetchingPhotos)
      console.log("fetchedPhotos",this.props.fetchedPhotos)
      console.log("albumsDateList",this.props.albumsDateList.length)
      console.log("fetchingAlbumsDateList",this.props.fetchingAlbumsDateList)
      console.log("fetchedAlbumsDateList",this.props.fetchedAlbumsDateList)


      return true
    }
    else {
      return false
    }
  }

  componentWillMount() {
    this.props.dispatch(simpleFetchPhotos())
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
  }

  groupPhotosByDate() {
    var photosGroupedByDate = {}
    photosGroupedByDate['Unknown Date'] = []

    this.props.photos.map(function(photo){
      if (photo.exif_timestamp != null) {
        var date = photo.exif_timestamp.split('T')[0]
        if (photosGroupedByDate.hasOwnProperty(date)){
          photosGroupedByDate[date].push(photo)
        }
        else{
          photosGroupedByDate[date] = []
          photosGroupedByDate[date].push(photo)
        }
      }
      else {
        photosGroupedByDate['Unknown Date'].push(photo)        
      }
    })
    return photosGroupedByDate
  }


  groupedPhotosToImageGrids(groupedPhotos) {
    var imageGrids = []
    for (var date in groupedPhotos) {
      if (groupedPhotos.hasOwnProperty(date)) {
        var imageGrid = groupedPhotos[date].map(function(photo){
          return (
			<div style={{
                width:this.state.entrySquareSize,
                display:'inline-block'}}>
            <LazyLoad once offset={500} height={this.state.entrySquareSize} placeholder={<ImagePlaceholder size={this.props.entrySquareSize}/>}>
              <Image 
                style={{
                    marginLeft:0,
                    marginRight:0,
                    marginTop:0,
                    marginBottom:0,
                    paddingLeft:1,
                    paddingRight:1,
                    paddingTop:1,
                    paddingBottom:1}}
                height={this.state.entrySquareSize} 
                width={this.state.entrySquareSize} 
                src={serverAddress+'/media/square_thumbnails_tiny/'+photo.image_hash+'.jpg'}/>
            </LazyLoad>
            </div>

          )
        },this)
        var groupHeight = this.state.entrySquareSize*Math.ceil(groupedPhotos[date].length/this.state.numEntrySquaresPerRow.toFixed(1))
        var renderableImageGrid = (
          <div key={date} style={{paddingBottom:'20px'}}>

            <Header as='h2'>
              <Header.Content>
              {date}
              <Header.Subheader>
              {imageGrid.length} Photos
              </Header.Subheader>
              </Header.Content>
            </Header>
            
            <LazyLoad 
                height={groupHeight} 
                offset={500} 
                placeholder={
                    <div style={{
                        height:groupHeight, 
                        backgroundColor:'white'}}></div>
                }>
            <Image.Group>
              {imageGrid}
            </Image.Group>
            </LazyLoad>
          </div>
        )
        imageGrids.push(renderableImageGrid)
      }
    }
    return imageGrids
  }


  render() {
    var entrySquareSize = this.state.entrySquareSize
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow
    console.log('received all props?', this.receivedAllProps())
    if (this.props.fetchedPhotos){
      var groupedPhotos = this.groupPhotosByDate()
      var renderable = this.groupedPhotosToImageGrids(groupedPhotos)
    }
    else {
      var renderable = (
        <div>
          <Dimmer active>
            <Loader active>
              <Header color='grey'>Loading Photos</Header>
              {"If you just added a lot of photos, or haven't visited this page in a while, "} 
              {"this might take a long time, depending on the number of photos in your library. "}
              {"After the intial load, subsequent visits to this page should be faster from caching."}
            </Loader>
          </Dimmer>
        </div>
      )
    }
    return (
      <div>
        {renderable}
      </div>
    )
  }
}




AllPhotosGroupedByDate = connect((store)=>{
  return {
    fetchedPhotos: store.photos.fetchedPhotos,
    fetchingPhotos: store.photos.fetchingPhotos,
    photos: store.photos.photos,    
    albumsDateList: store.albums.albumsDateList,
    fetchingAlbumsDateList: store.albums.fetchingAlbumsDateList,
    fetchedAlbumsDateList: store.albums.fetchedAlbumsDateList,
  }
})(AllPhotosGroupedByDate)
