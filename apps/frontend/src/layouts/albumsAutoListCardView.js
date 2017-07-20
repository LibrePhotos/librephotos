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
         Container, Label, Popup, Segment, Button, Icon} from 'semantic-ui-react';
import { connect } from "react-redux";
import {fetchAutoAlbumsList} from '../actions/albumsActions'



import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums} from '../actions/albumsActions'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'




export class AlbumsAutoListCardView extends PureComponent {
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

    if (this.props.fetchedAlbumsAutoList) {
      return (
        <Container fluid>
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

          <div style={{paddingBottom:'20px'}}>

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
          {child}
        </Container>
      );
    }
    else {
      return (<div><Loader/></div>)
    }
  }

  _calculateColumnCount() {
    const { columnWidth, gutterSize } = this.state;

    this._columnCount = Math.floor(this._width / (columnWidth + gutterSize));
  }

  _cellRenderer({ index, key, parent, style }) {
    const { columnWidth } = this.state;
    console.log(this.props.albumsAutoList[index])

    var numPeople = this.props.albumsAutoList[index].people.length
    var albumId = this.props.albumsAutoList[index].people.id
    if (this.props.albumsAutoList[index].people.length > 0) {
      var mappedPeopleIcons = this.props.albumsAutoList[index].people.map(function(person){
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
      var mappedPeopleIcons = (<div style={{height:'30px', width:'30px', verticalAlign:'middle'}}>Nobody</div>)
    }

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
              width: "200px",
            }}/>
            <Card>
              <Image height={200} width={200}
                src={"http://localhost:8000"+this.props.albumsAutoList[index].cover_photo_url}/>
              <Card.Content>
              <Header as='h4'>{this.props.albumsAutoList[index].title}</Header>
              <Card.Meta>
              {this.props.albumsAutoList[index].photo_count} Photos
              <br/>{this.props.albumsAutoList[index].timestamp}
              </Card.Meta>        
              </Card.Content>
              <Card.Content extra>
              {mappedPeopleIcons}
              </Card.Content>
            </Card>        
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