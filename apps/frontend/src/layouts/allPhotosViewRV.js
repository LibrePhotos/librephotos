import React, { PureComponent, Component } from "react";
import {
  CellMeasurer,
  CellMeasurerCache,
  createMasonryCellPositioner,
  Masonry,
  AutoSizer,
  WindowScroller,
} from 'react-virtualized';
import styles from 'react-virtualized/styles.css'; // only needs to be imported once
import { Image, Header, Divider, Loader, Dimmer, List, Icon } from 'semantic-ui-react';
import { connect } from "react-redux";
import { fetchPhotos } from '../actions/photosActions'
import { serverAddress } from '../api_client/apiClient'
import { ChartyPhotosScrollbar } from '../components/chartyPhotosScrollbar'


const month2month = {
  "01":"January",
  "02":"February",
  "03":"March",
  "04":"April",
  "05":"May",
  "06":"June",
  "07":"July",
  "08":"August",
  "09":"September",
  "10":"October",
  "11":"November",
  "12":"December"
}


export class PhotosListCardView extends Component {
  constructor(props){
    super(props)
    this.insertMonthCardIntoPhotosList = this.insertMonthCardIntoPhotosList.bind(this)
  }

  componentWillMount(){
    this.props.dispatch(fetchPhotos())
  }

  insertMonthCardIntoPhotosList(){
    var newPhotosList = []


    var sortedPhotos = this.props.photos.sort(function(a,b){
      // Turn your strings into dates, and then subtract them
      // to get a value that is either negative, positive, or zero.
      return new Date(b.exif_timestamp) - new Date(a.exif_timestamp);
    });


    sortedPhotos.map(function(photo){
      if (newPhotosList.length>0){
        if (photo.exif_timestamp == null) { 
          var newMonth = "Unknown-date"
        }
        else {
          var lastMonth = newPhotosList[newPhotosList.length-1].exif_timestamp.split('T')[0].split('-').slice(0,2).join('-')
          var thisMonth = photo.exif_timestamp.split('T')[0].split('-').slice(0,2).join('-')
          if (lastMonth==thisMonth) {
            newPhotosList.push(photo)
          } 
          else {
            newPhotosList.push(thisMonth)
            newPhotosList.push(photo)          
          }
        }
      }
      else {
        if (photo.exif_timestamp == null) { 
          var newMonth = "Unknown-date"
        }

        else {
          var newMonth = photo.exif_timestamp.split('T')[0].split('-').slice(0,2).join('-')
          newPhotosList.push(newMonth)
          newPhotosList.push(photo)
        }
      }
    })
    console.log(newPhotosList)
    newPhotosList.map(function(photo){
      console.log(typeof(photo)=='string')
    })
    return newPhotosList
  }

  render() {
    if (this.props.fetchedPhotos) {
      var photosListWithMonthCards = this.insertMonthCardIntoPhotosList()
      var months = photosListWithMonthCards.filter(function(element){
        if (typeof(element)=='string'){
          return true
        }
        else {
          return false
        }
      })
      var monthScroll = months.map(function(month){
        return <List.Item>{month.split('-')[1]}</List.Item>
      })
      return (
        <div>
          <div style={{
            position:'fixed',
            right:'0px',
            height:"100%",
            width:'80px',
            border:'1px solid #dddddd',
            backgroundColor:'#f2f2f2'}}>
            <ChartyPhotosScrollbar/>
          </div>
          <div style={{paddingRight:'90px'}}>
            <div style={{width:'100%', textAlign:'center', paddingTop:'20px'}}>
              <Icon.Group size='huge'>
                <Icon inverted circular name='image'/>
              </Icon.Group>
            </div>
            <Header as='h2' icon textAlign='center'>
              <Header.Content>
                Photos
                <Header.Subheader>All photos</Header.Subheader>
              </Header.Content>
            </Header>

            <Divider hidden/>
            <PhotoListCards photos={photosListWithMonthCards}/>
          </div>
        </div>
      )
    }
    else {
      return (
        <div style={{padding:"10px"}}>
          <Dimmer active>
            <Loader active>
              Loading photos...
            </Loader>
          </Dimmer>
        </div>
      )      
    }
  }
}


export class MonthCard extends Component {
  render() {
    return (
        <div style={{
          border:'1px solid #dddddd',
          width:'150px',
          height:'150px',
          padding:'10px',
          borderRadius: "0.3rem"}}>
          <Header dividing as='h2'>
              {month2month[this.props.month.split('-')[1]]}
          </Header>
          <Header textAlign='left' as='h3'>
              {this.props.month.split('-')[0]}
          </Header>
        </div>
    )
  }
}


export class PhotoCard extends Component {
  render() {
    return (
      <div style={{
        width:'150px',
        height:'150px'}}>
          <Image 
            height={150} 
            width={150} 
            src={serverAddress+this.props.photo.tiny_square_thumbnail_url}/>
      </div>
    )
  }
}






export class PhotoListCards extends PureComponent {
  constructor(props, context) {
    super(props, context);

    this._columnCount = 0;

    this._cache = new CellMeasurerCache({
      defaultHeight: 150,
      defaultWidth: 150,
      fixedWidth: true
    });

    this._columnHeights = {};

    this.state = {
      columnWidth: 150,
      height: 150,
      gutterSize: 5,
      windowScrollerEnabled: true
    };


    this._cellRenderer = this._cellRenderer.bind(this);
    this._onResize = this._onResize.bind(this);
    this._renderAutoSizer = this._renderAutoSizer.bind(this);
    this._renderMasonry = this._renderMasonry.bind(this);
    this._setMasonryRef = this._setMasonryRef.bind(this);
  }

  render() {
    const {
      columnWidth,
      height,
      gutterSize,
      windowScrollerEnabled
    } = this.state;

    let child;

    if (windowScrollerEnabled) {
      child = (
        <WindowScroller>
          {this._renderAutoSizer}
        </WindowScroller>
      );
    } else {
      child = this._renderAutoSizer({ height });
    }

    return (
      <div style={{paddingTop:'10px'}}>{child}</div>
    );

  }

  _calculateColumnCount() {
    const { columnWidth, gutterSize } = this.state;

    this._columnCount = Math.floor(this._width / (columnWidth + gutterSize));
  }

  _cellRenderer({ index, key, parent, style }) {
    const { columnWidth } = this.state;
    if (typeof(this.props.photos[index])=='string') {
      console.log('rendering month card')
      return (
        <CellMeasurer cache={this._cache} index={index} key={key} parent={parent}>
          <div
            className={styles.Cell}
            style={{
              ...style,
              width: columnWidth
            }}
          >
            <div
              style={{
              }}/>
              <MonthCard month={this.props.photos[index]}/>

          </div>
        </CellMeasurer>      
      )
    }
    else if (typeof(this.props.photos[index])=='object'){
      return (
        <CellMeasurer cache={this._cache} index={index} key={key} parent={parent}>
          <div
            className={styles.Cell}
            style={{
              ...style,
              width: columnWidth
            }}
          >
            <div
              style={{
              }}/>
              <PhotoCard photo={this.props.photos[index]}/>

          </div>
        </CellMeasurer>
      );
    }
  }

  _initCellPositioner() {
    if (typeof this._cellPositioner === "undefined") {
      const { columnWidth, gutterSize } = this.state;

      this._cellPositioner = createMasonryCellPositioner({
        cellMeasurerCache: this._cache,
        columnCount: this._columnCount,
        columnWidth,
        spacer: gutterSize
      });
    }
  }

  _onResize({ width }) {
    this._width = width;

    this._columnHeights = {};
    this._calculateColumnCount();
    this._resetCellPositioner();
    this._masonry.recomputeCellPositions();
  }

  _renderAutoSizer({ height, scrollTop }) {
    this._height = height;
    this._scrollTop = scrollTop;

    return (
      <AutoSizer
        disableHeight
        onResize={this._onResize}
        scrollTop={this._scrollTop}
      >
        {this._renderMasonry}
      </AutoSizer>
    );
  }

  _renderMasonry({ width }) {
    this._width = width;

    this._calculateColumnCount();
    this._initCellPositioner();

    const { height, windowScrollerEnabled } = this.state;
    return (
      <div style={{paddingLeft:'10px'}}>
        <Masonry
          autoHeight={windowScrollerEnabled}
          cellCount={this.props.photos.length}
          cellMeasurerCache={this._cache}
          cellPositioner={this._cellPositioner}
          cellRenderer={this._cellRenderer}
          height={windowScrollerEnabled ? this._height : height}
          ref={this._setMasonryRef}
          scrollTop={this._scrollTop}
          width={width}/>
      </div>
    );
  }

  _resetCellPositioner() {
    const { columnWidth, gutterSize } = this.state;

    this._cellPositioner.reset({
      columnCount: this._columnCount,
      columnWidth,
      spacer: gutterSize
    });
  }

  _setMasonryRef(ref) {
    this._masonry = ref;
  }
}


PhotosListCardView = connect((store)=>{
  return {
    fetchedPhotos: store.photos.fetchedPhotos,
    fetchingPhotosfetchedPhotos: store.photos.fetchingPhotos,
    photos: store.photos.photos,
  }
})(PhotosListCardView)

