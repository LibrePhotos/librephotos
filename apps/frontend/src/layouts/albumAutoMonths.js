import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums, fetchAutoAlbumsList} from '../actions/albumsActions'
import {AlbumAutoCard, AlbumAutoCardPlain, AlbumAutoCardPlainPlaceholder, AlbumAutoGallery} from '../components/album'
import {Container, Icon, Header, Button, Card, Label, Popup, Divider} from 'semantic-ui-react'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'

import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';


export class AlbumAutoMonthCards extends Component {
  render() {

      var match = this.props.match
      var month = this.props.month
      var mappedAlbumCards = this.props.albums.map(function(album){
        var albumTitle = album.title
        var albumDate = album.timestamp.split('T')[0]
        try {
          var albumCoverURL = album.cover_photo_url
        }
        catch(err) {
          console.log(err)
          var albumCoverURL = null
        }
        return (
          <LazyLoad height={360} placeholder={<AlbumAutoCardPlainPlaceholder/>}>
            <AlbumAutoCardPlain album={album}/>
          </LazyLoad>
        )
      })


    return (
      <div style={{paddingTop:'20px'}}>
        <Header dividing as='h2'>
          <Header.Content>
            {this.props.month}
            <Header.Subheader>{this.props.albums.length} Events</Header.Subheader>
          </Header.Content>
        </Header>
        <div>
          <Card.Group stackable itemsPerRow={5}>
          {mappedAlbumCards}
          </Card.Group>
        </div>
      </div>
    )
  }
}



export class AlbumAutoMonths extends Component {
  constructor(props){
    super(props)
    this.groupEventsByMonth.bind(this)
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

  shouldComponentUpdate(nextProps, nextState){
    console.log('should component update?')
    if (nextProps.albumsAutoList === this.props.albumsAutoList) {
      console.log('no')
      return false
    }
    else {
      console.log('yes')
      return true
    }
  }


  handleAutoAlbumGen = e => this.props.dispatch(generateAutoAlbums())

  groupEventsByMonth() {
    var allMonths = this.props.albumsAutoList.map(function(album){
      var yearMonthDate = album.timestamp.split('T')[0]
      var yearMonth = yearMonthDate.split('-').slice(0,2).join('-')
      return yearMonth
    })

    var months = new Set(allMonths)
    months = [...months]
    var eventsByMonth = {}
    months.map(function(month){
      eventsByMonth[month] = []
    })
    this.props.albumsAutoList.map(function(album){
      var yearMonthDate = album.timestamp.split('T')[0]
      var yearMonth = yearMonthDate.split('-').slice(0,2).join('-')
      eventsByMonth[yearMonth].push(album)
    })
    console.log(eventsByMonth)
    return eventsByMonth
  }

  render() {
    var eventsByMonth = this.groupEventsByMonth()
    if (this.props.fetchedAlbumsAutoList) {
      var match = this.props.match
      var eventsByMonthCardGroups = []
      for (var month in eventsByMonth) {
        if (eventsByMonth.hasOwnProperty(month)) {
          var cardsMonth = (
            <AlbumAutoMonthCards key={month} month={month} albums={eventsByMonth[month]}/>
          )
          eventsByMonthCardGroups.push(cardsMonth)
        }
      }
      console.log(eventsByMonthCardGroups)


    }
    else {
      var eventsByMonthCardGroups = null
    }


    return (
      <Container fluid>
        <div style={{width:'100%', textAlign:'center'}}>
          <Icon.Group size='huge'>
            <Icon inverted circular name='image'/>
            <Icon inverted circular corner name='wizard'/>
          </Icon.Group>
        </div>
        <Header as='h1' icon textAlign='center'>
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

        {eventsByMonthCardGroups}
      </Container>
    )
  }
}





AlbumAutoMonths = connect((store)=>{
  return {
    albumsAuto: store.albums.albumsAuto,
    fetchingAlbumsAuto: store.albums.fetchingAlbumsAuto,
    fetchedAlbumsAuto: store.albums.fetchedAlbumsAuto,
    
    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,

    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    generatedAlbumsAuto: store.albums.generatedAlbumsAuto,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    statusPhotoScan: store.util.statusPhotoScan,
    scanningPhotos: store.photos.scanningPhotos,

  }
})(AlbumAutoMonths)
