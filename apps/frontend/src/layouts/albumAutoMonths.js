import React, {Component} from 'react';
import { connect } from "react-redux";
import { generateAutoAlbums, fetchAutoAlbumsList } from '../actions/albumsActions'
import { AlbumAutoCardPlain, AlbumAutoCardPlainPlaceholder } from '../components/album'
import { Container, Header, Card } from 'semantic-ui-react'
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
    /*
    var intervalId = setInterval(function(){
        _dispatch(fetchPhotoScanStatus())
        _dispatch(fetchAutoAlbumProcessingStatus())
      },2000
    )
    this.setState({intervalId:intervalId})
    */
  }

  componentWillUnmount() {
    //clearInterval(this.state.intervalId)
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
