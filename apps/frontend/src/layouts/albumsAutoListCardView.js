import Immutable from "immutable";
import PropTypes from "prop-types";
import React, { PureComponent, Component} from "react";import {
  Collection,
  CellMeasurer,
  CellMeasurerCache,
  createMasonryCellPositioner,
  Masonry,
  AutoSizer,
  WindowScroller,
} from 'react-virtualized';
import styles from 'react-virtualized/styles.css'; // only needs to be imported once
import { Card, Image, Header, Divider, Item, Loader, Dimmer,
         Container, Label, Popup, Segment, Button, Icon, Rating} from 'semantic-ui-react';
import { connect } from "react-redux";


import {fetchAutoAlbumsList} from '../actions/albumsActions'

import {
  BrowserRouter as Router,
  Route,
  Link
} from 'react-router-dom'

import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums} from '../actions/albumsActions'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'






export class AlbumAutoCard2 extends Component{
  render() {
    var numPeople = this.props.album.people.length
    var albumId = this.props.album.people.id
    if (this.props.album.people.length > 0) {
      var mappedPeopleIcons = this.props.album.people.map(function(person){
        return (
          <Popup
            key={'album-auto-card-'+albumId+'-'+person.name}
            trigger={<Image height={30} width={30} shape='circular' src={'http://localhost:8000'+person.face_url}/>}
            position="top center"
            content={person.name}
            size="tiny"
            inverted
            basic/>)
      })
    }
    else {
      // empty placeholder so the extra portion (with face icons) of the cards line up
      var mappedPeopleIcons = (<div style={{height:'30px', width:'30px', verticalAlign:'middle'}}></div>)
    }
    return (
      <Card fluid>
        <Image fluid 
          as={Link}
          to={`autoview/${this.props.album.id}`}
          src={"http://localhost:8000"+this.props.album.cover_photo_url}/>
        <Card.Content>
        <Header as='h4'>{this.props.album.title}</Header>
        <Card.Meta>
        {this.props.album.photo_count} Photos
        <br/>{this.props.album.timestamp.split('T')[0]}
        </Card.Meta>        
        </Card.Content>
        <Card.Content extra>
        {mappedPeopleIcons}
        </Card.Content>
      </Card>
    )
  }      
}








export class AlbumAutoMonthCardGrid extends Component {
  render() {
    var mappedCards = this.props.albums.map(function(album){
      return (<AlbumAutoCard2 album={album}/>)
    })
    return (
      <Card.Group>
        {mappedCards}
      </Card.Group>
    )
  }
}




export class AlbumsAutoListCardView extends Component {
  render() {
    if (this.props.fetchedAlbumsAutoList) {
      return (
        <Container>
          <AlbumsAutoListHeader/>
          <AlbumsAutoListCards albums={this.props.albumsAutoList}/>
        </Container>
      )
    }
    else {
      return (
        <Container>
          <AlbumsAutoListHeader/>
        </Container>
      )      
    }
  }
}


export class AlbumAutoCard extends Component {
  render() {

    var numPeople = this.props.album.people.length
    var albumId = this.props.album.people.id
    if (this.props.album.people.length > 0) {
      var mappedPeopleIcons = this.props.album.people.map(function(person){
        return (
          <Popup
            key={'album-auto-card-'+albumId+'-'+person.name}
            trigger={<Image height={30} width={30} shape='circular' src={'http://localhost:8000'+person.face_url}/>}
            position="top center"
            content={person.name}
            size="tiny"
            inverted
            basic/>)
      })
    }
    else {
      // empty placeholder so the extra portion (with face icons) of the cards line up
      var mappedPeopleIcons = (<div style={{height:'30px', width:'30px', verticalAlign:'middle'}}></div>)
    }

    return (
      <div style={{
        border:'1px solid #dddddd',
        width:'200px',
        borderRadius: "0.3rem"}}>

        <Image height={200} width={200} src={"http://localhost:8000"+this.props.album.cover_photo_url}/>
        <div style={{padding:'10px'}}>
          <span style={{fontSize:'15',fontWeight:'bold'}}>{this.props.album.title}</span><br/>
          <div style={{paddingTop:'5px'}}>
            <span style={{color:'grey'}}>{this.props.album.timestamp.split('T')[0]}</span>
          </div>
          <div style={{paddingTop:'5px', textAlign:'right'}}>
            <span style={{color:'grey',fontWeight:'bold'}}>{this.props.album.photo_count} Photos</span>
          </div>
          <div style={{paddingTop:'5px', textAlign:'right'}}>
            <Rating icon='heart' defaultRating={0} maxRating={1} />
          </div>
        </div>
        <div style={{padding:'10px',textAlign:'left', borderTop:'1px solid #dddddd'}}>
          {mappedPeopleIcons}
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
        <Header dividing as='h2' icon textAlign='center'>
          <Header.Content>
            Events
            <Header.Subheader>View automatically generated event albums</Header.Subheader>
          </Header.Content>
        </Header>

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
      defaultWidth: 200,
      fixedWidth: true
    });

    this._columnHeights = {};

    this.state = {
      columnWidth: 200,
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
      <div style={{padding:'10px'}}>{child}</div>
    );

  }

  _calculateColumnCount() {
    const { columnWidth, gutterSize } = this.state;

    this._columnCount = Math.floor(this._width / (columnWidth + gutterSize));
  }

  _cellRenderer({ index, key, parent, style }) {
    const { columnWidth } = this.state;

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


