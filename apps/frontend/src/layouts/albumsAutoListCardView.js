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
import { Image, Header, Divider, Loader, Dimmer, Popup, Button, Icon, Rating } from 'semantic-ui-react';
import { connect } from "react-redux";
import { fetchAutoAlbumsList } from '../actions/albumsActions'
import { BrowserRouter as Link } from 'react-router-dom'
import { generateAutoAlbums } from '../actions/albumsActions'
import { fetchPhotoScanStatus, fetchAutoAlbumProcessingStatus } from '../actions/utilActions'
import { serverAddress } from '../api_client/apiClient'


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


export class AlbumsAutoListCardView extends Component {
  constructor(props){
    super(props)
    this.insertMonthCardsIntoAlbumsList = this.insertMonthCardsIntoAlbumsList.bind(this)
  }

  insertMonthCardsIntoAlbumsList(){
    var newAlbumsList = []

    this.props.albumsAutoList.map(function(album){
      if (newAlbumsList.length>0){
        var lastMonth = newAlbumsList[newAlbumsList.length-1].timestamp.split('T')[0].split('-').slice(0,2).join('-')
        var thisMonth = album.timestamp.split('T')[0].split('-').slice(0,2).join('-')
        if (lastMonth==thisMonth) {
          newAlbumsList.push(album)
        } 
        else {
          newAlbumsList.push(thisMonth)
          newAlbumsList.push(album)          
        }
      }
      else {
        var newMonth = album.timestamp.split('T')[0].split('-').slice(0,2).join('-')
        newAlbumsList.push(newMonth)
        newAlbumsList.push(album)
      }
    })
    return newAlbumsList
  }

  render() {
    if (this.props.fetchedAlbumsAutoList) {
      var albumListWithMonthCards = this.insertMonthCardsIntoAlbumsList()
      return (
        <div style={{padding:"10px"}}>
          <AlbumsAutoListHeader/>
          <AlbumsAutoListCards albums={albumListWithMonthCards}/>
        </div>
      )
    }
    else {
      return (
        <div style={{padding:"10px"}}>
          <AlbumsAutoListHeader/>
          <Dimmer active>
            <Loader active>
              Loading Event Albums List...
              Might take a while if not cached in the server.
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
        width:'150px',
        height:'300px'}}>
        <div style={{position:'absolute',top:'100px',textAlign:'center'}}>
          <Header as='h1'>
            <Header.Content>
              {month2month[this.props.month.split('-')[1]]}
              <Header.Subheader as='h1' textAlign="center">
                {this.props.month.split('-')[0]}
              </Header.Subheader>
            </Header.Content>
          </Header>
        </div>
      </div>
    )
  }
}


export class AlbumAutoCard extends Component {
  render() {
    var numPeople = this.props.album.people.length
    var albumId = this.props.album.people.id
    if (this.props.album.people.length > 0) {
      var mappedPeopleIcons = this.props.album.people.map(function(person){
        return (
          <Image height={30} width={30} shape='circular' src={serverAddress+person.face_url}/>
        )
      })
      mappedPeopleIcons = (
        <Image.Group>{mappedPeopleIcons}</Image.Group>
      )
    }
    else {
      // empty placeholder so the extra portion (with face icons) of the cards line up
      var mappedPeopleIcons = (<div style={{height:'30px', width:'30px', verticalAlign:'middle'}}></div>)
    }
    return (
      <div style={{
        border:'1px solid #dddddd',
        width:'150px',
        height:'300px',
        borderRadius: "0.3rem"}}>
        <Image 
          as={Link}
          to={`/albums/autoview/${this.props.album.id}`}
          height={200} width={150} 
          src={serverAddress+this.props.album.cover_photo_url}/>
        <div style={{padding:'10px'}}>
          <span style={{fontSize:'15',fontWeight:'bold'}}>{this.props.album.title}</span><br/>
          <div style={{paddingTop:'5px'}}>
            <span style={{color:'grey'}}>{this.props.album.timestamp.split('T')[0]}</span>
          </div>
          <div style={{paddingTop:'5px', textAlign:'right',top:'240px',position:'absolute'}}>
            <span style={{color:'grey',fontWeight:'bold'}}>{this.props.album.photo_count} Photos</span>
          </div>
          <div style={{paddingTop:'5px', textAlign:'right',top:'260px',position:'absolute'}}>
            <Popup
              trigger={
                <span style={{
                  color:'grey',
                  fontWeight:'bold'}}>
                  {this.props.album.people.length} People
                </span>}
              content={mappedPeopleIcons}
              basic/>
          </div>
          <div style={{paddingTop:'5px', textAlign:'right',top:'260px',left:'120px',position:'absolute'}}>
            <Rating icon='heart' defaultRating={0} maxRating={1} />
          </div>
        </div>
      </div>
    )
  }
}

export class AlbumsAutoListHeader extends Component {

  componentWillMount() {
    this.props.dispatch(fetchAutoAlbumsList())
    var _dispatch = this.props.dispatch
    var intervalId = setInterval(function(){
        _dispatch(fetchPhotoScanStatus())
        _dispatch(fetchAutoAlbumProcessingStatus())
      },2000
    )
    this.setState({intervalId:intervalId})
  }

  componentWillUnmount() {
    clearInterval(this.state.intervalId)
  }

  handleAutoAlbumGen = e => this.props.dispatch(generateAutoAlbums())


  render() {
    return (
      <div>
        <div style={{width:'100%', textAlign:'center', paddingTop:'20px'}}>
          <Icon.Group size='huge'>
            <Icon inverted circular name='image'/>
            <Icon inverted circular corner name='wizard'/>
          </Icon.Group>
        </div>
        <Header as='h2' icon textAlign='center'>
          <Header.Content>
            Events
            <Header.Subheader>View automatically generated event albums</Header.Subheader>
          </Header.Content>
        </Header>
        <Divider hidden/>
        <div>
          <Button 
            onClick={this.handleAutoAlbumGen}
            loading={this.props.statusAutoAlbumProcessing.status}
            disabled={
              this.props.statusAutoAlbumProcessing.status||
              this.props.statusPhotoScan.status||
              this.props.generatingAlbumsAuto||
              this.props.scanningPhotos
            }
            fluid 
            color='blue'>
            <Icon name='wizard'/>Generate More
          </Button>
        </div>
      </div>
    )
  }
}





export class AlbumsAutoListCards extends PureComponent {
  constructor(props, context) {
    super(props, context);

    this._columnCount = 0;

    this._cache = new CellMeasurerCache({
      defaultHeight: 10,
      defaultWidth: 150,
      fixedWidth: true
    });

    this._columnHeights = {};

    this.state = {
      columnWidth: 150,
      height: 200,
      gutterSize: 10,
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
    if (typeof(this.props.albums[index])=='object'){
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
              <AlbumAutoCard album={this.props.albums[index]}/>

          </div>
        </CellMeasurer>
      );
    }
    else {
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
              <MonthCard month={this.props.albums[index]}/>

          </div>
        </CellMeasurer>      )
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
    console.log(height)
    return (
      <div style={{paddingLeft:'10px'}}>
        <Masonry
          autoHeight={windowScrollerEnabled}
          cellCount={this.props.albumsAutoList.length}
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


AlbumsAutoListCardView = connect((store)=>{
  return {
    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,
    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    generatedAlbumsAuto: store.albums.generatedAlbumsAuto,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    statusPhotoScan: store.util.statusPhotoScan,
    scanningPhotos: store.photos.scanningPhotos,
  }
})(AlbumsAutoListCardView)



AlbumsAutoListCards = connect((store)=>{
  return {
    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,
    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    generatedAlbumsAuto: store.albums.generatedAlbumsAuto,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    statusPhotoScan: store.util.statusPhotoScan,
    scanningPhotos: store.photos.scanningPhotos,
  }
})(AlbumsAutoListCards)



AlbumsAutoListHeader = connect((store)=>{
  return {
    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,
    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    generatedAlbumsAuto: store.albums.generatedAlbumsAuto,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    statusPhotoScan: store.util.statusPhotoScan,
    scanningPhotos: store.photos.scanningPhotos,
  }
})(AlbumsAutoListHeader)


