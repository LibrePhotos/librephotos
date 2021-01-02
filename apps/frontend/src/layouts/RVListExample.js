/**
 * @flow
 */
import React, { PureComponent } from "react";
import { fetchPhotos } from '../actions/photosActions'
import {
  CellMeasurer,
  CellMeasurerCache,
  AutoSizer,
  List,
  WindowScroller,
} from 'react-virtualized';
import { connect } from "react-redux";
import { Image } from 'semantic-ui-react';
import { serverAddress } from '../api_client/apiClient'


function toInt(n){ return Math.round(Number(n)); };


const cache = new CellMeasurerCache({
  defaultHeight: 50,
  fixedWidth: true
});


export class ListExample extends PureComponent {
  constructor(props, context) {
    super(props, context);

    this.state = {
      groupedPhotos: {},
      thumbnailSize: 150
    };

    // this._getRowHeight = this._getRowHeight.bind(this);
    // this._onResize = this._onResize.bind(this);
    // this._noRowsRenderer = this._noRowsRenderer.bind(this);
    // this._onRowCountChange = this._onRowCountChange.bind(this);
    // this._onScrollToRowChange = this._onScrollToRowChange.bind(this);
    this._rowRenderer = this._rowRenderer.bind(this);
    this._renderAutoSizer = this._renderAutoSizer.bind(this);
    this._renderList = this._renderList.bind(this);
    this.groupPhotosByDate = this.groupPhotosByDate.bind(this);
  }


  componentWillMount(){
    this.props.dispatch(fetchPhotos())
  }

  groupPhotosByDate(photos) {
    var photosGroupedByDate = {}
    photosGroupedByDate['Unknown Date'] = []
    photos.map(function(photo){
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



  componentWillReceiveProps(nextProps) {
    if (nextProps.photos.length > 0){
      var groupedPhotos = this.groupPhotosByDate(nextProps.photos)
      this.setState({groupedPhotos:groupedPhotos})
    }
  }

  render() {
    if (this.props.fetchedPhotos) {
      return (
        <WindowScroller>
          {this._renderAutoSizer}
        </WindowScroller>
      );
    }
    else {
      return (
        <div>fetching photos</div>
      )
    }
  }

  _renderList({width}){
   return (
      <List
        autoHeight={true}
        height={1000}
        deferredMeasurementCache={cache}
        rowCount={20}
        rowHeight={cache.rowHeight}
        rowRenderer={this._rowRenderer}
        width={width}/>
    );  
  }

  _renderAutoSizer({ height, scrollTop }) {
    this._height = height;
    this._scrollTop = scrollTop;
    return (
      <AutoSizer
        onResize={this._onResize}
        scrollTop={this._scrollTop}>
        {this._renderList}
      </AutoSizer>
    );
  }

  // _onResize({ width }) {
  //   this._width = width - 215;
  // }




  // _getRowHeight({ index }) {
  //   var key = Object.keys(this.state.groupedPhotos)[index];
  //   var numPhotosInGroup = this.state.groupedPhotos[key].length
  //   var numPhotosPerRow = toInt(Math.floor(this._width/(this.state.thumbnailSize+7)))
  //   var numPhotosPerCol = toInt(Math.ceil(numPhotosInGroup/numPhotosPerRow))
  //   var rowHeight = numPhotosPerCol * (this.state.thumbnailSize+7)

  //   var rowHeight = toInt(rowHeight)
  //   console.log(rowHeight)
  //   return toInt(rowHeight)+100
  // }

  //   var thumbnailSize = this.state.thumbnailSize+7
  //   var height = 0
  //   var keys = Object.keys(this.state.groupedPhotos)
  //   console.log(keys.length)
  //   var groupedPhotos = this.state.groupedPhotos
  //   var width = this._width
  //   keys.map(function(key){
  //     var numPhotosInGroup = groupedPhotos[key].length
  //     var numPhotosPerRow = width/thumbnailSize
  //     var numPhotosPerCol = numPhotosInGroup/numPhotosPerRow
  //     var rowHeight = numPhotosPerCol * thumbnailSize
  //     height += rowHeight
  //   })
  //   return toInt(height)
  // }

  // _noRowsRenderer() {
  //   return <div style={{height:'500px'}}>No rows</div>;
  // }

  // _onRowCountChange(event) {
  //   console.log('row count changed')
  //   const rowCount = parseInt(event.target.value, 10) || 0;

  //   this.setState({ rowCount });
  // }

  // _onScrollToRowChange(event) {
  //   const { rowCount } = this.state;
  //   let scrollToIndex = Math.min(
  //     rowCount - 1,
  //     parseInt(event.target.value, 10)
  //   );

  //   if (isNaN(scrollToIndex)) {
  //     scrollToIndex = undefined;
  //   }

  //   this.setState({ scrollToIndex });
  // }

  _rowRenderer({ index, isScrolling, key, parent, style, isVisible }) {
    console.log(index,isVisible)
    console.log(this.props.photos.length)

    var group = this.state.groupedPhotos[Object.keys(this.state.groupedPhotos)[index]]
    var thumbnailSize = this.state.thumbnailSize
    var mappedImages = group.map(function(photo,idx){
      return (
          <Image key={'image-'+index+'-'+idx}
            height={thumbnailSize}
            width={thumbnailSize}
            src={serverAddress+photo.square_thumbnail_url}/>
      )
    })

    return (
      <CellMeasurer
        cache={cache}
        columnIndex={0}
        key={key}
        parent={parent}
        rowIndex={index}>
        {
          ({measure}) => (
            <div style={style}>
            {index}:<img onLoad={measure} src={serverAddress+this.props.photos[index].thumbnail_url}/>
            </div>
          )
        }
      </CellMeasurer>
    )
  }
}





ListExample = connect((store)=>{
  return {
    fetchingPhotos:store.photos.fetchingPhotos,
    fetchedPhotos:store.photos.fetchedPhotos,
    photos:store.photos.photos,
  }
})(ListExample)


