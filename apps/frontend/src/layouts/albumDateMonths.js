import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums, fetchDateAlbumsList} from '../actions/albumsActions'
import {AlbumDateCard, AlbumDateCardPlaceholder, AlbumDateCardPlain, AlbumDateCardPlainPlaceholder, AlbumAutoGallery} from '../components/album'
import {Container, Icon, Header, Button, Card, Label, Popup, Divider} from 'semantic-ui-react'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'

import {Server, serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';


export class AlbumDateMonthCards extends Component {
  render() {

      var match = this.props.match
      var month = this.props.month
      var mappedAlbumCards = this.props.albums.map(function(album){
        var albumTitle = album.title
        var albumDate = album.date
        try {
          var albumCoverURL = album.cover_photo_url
        }
        catch(err) {
          console.log(err)
          var albumCoverURL = null
        }
        return (
          <LazyLoad height={290} placeholder={<AlbumDateCardPlainPlaceholder/>}> 
            <AlbumDateCardPlain album={album}/>
          </LazyLoad>
        )
      })


    return (
      <div style={{paddingTop:'20px'}}>
        <Header dividing as='h2'>
          <Header.Content>
            {this.props.month}
            <Header.Subheader>{this.props.albums.length} Days</Header.Subheader>
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



export class AlbumDateMonths extends Component {
  constructor(props){
    super(props)
    this.groupDatesByMonth.bind(this)
  }

  componentWillMount() {
    this.props.dispatch(fetchDateAlbumsList())

  }

  shouldComponentUpdate(nextProps, nextState){
    console.log('should component update?')
    if (nextProps.albumsDateList === this.props.albumsDateList) {
      console.log('no')
      return false
    }
    else {
      console.log('yes')
      return true
    }
  }

  groupDatesByMonth() {
    var allMonths = this.props.albumsDateList.map(function(album){
      var yearMonth = album.date.split('-').slice(0,2).join('-')
      return yearMonth
    })

    var months = new Set(allMonths)
    months = [...months]
    var eventsByMonth = {}
    months.map(function(month){
      eventsByMonth[month] = []
    })
    this.props.albumsDateList.map(function(album){
      var yearMonth = album.date.split('-').slice(0,2).join('-')
      eventsByMonth[yearMonth].push(album)
    })
    console.log(eventsByMonth)
    return eventsByMonth
  }

  render() {
    if (this.props.fetchedAlbumsDateList) {
      var eventsByMonth = this.groupDatesByMonth()
      var match = this.props.match
      var datesByMonthCardGroups = []
      for (var month in eventsByMonth) {
        if (eventsByMonth.hasOwnProperty(month)) {
          var cardsMonth = (
            <AlbumDateMonthCards key={month} month={month} albums={eventsByMonth[month]}/>
          )
          datesByMonthCardGroups.push(cardsMonth)
        }
      }
      console.log(datesByMonthCardGroups)


    }
    else {
      var datesByMonthCardGroups = null
    }


    return (
      <Container fluid>
        <div style={{width:'100%', textAlign:'center'}}>
          <Icon.Group size='huge'>
            <Icon inverted circular name='image'/>
            <Icon inverted circular corner name='calendar'/>
          </Icon.Group>
        </div>
        <Header as='h1' icon textAlign='center'>
          <Header.Content>
            Dates
            <Header.Subheader>View photos grouped by dates</Header.Subheader>
          </Header.Content>
        </Header>
        <Divider hidden/>
        <div>
        </div>
        {datesByMonthCardGroups}
      </Container>
    )
  }
}





AlbumDateMonths = connect((store)=>{
  return {
    albumsDateList: store.albums.albumsDateList,
    fetchingAlbumsDateList: store.albums.fetchingAlbumsDateList,
    fetchedAlbumsDateList: store.albums.fetchedAlbumsDateList,
  }
})(AlbumDateMonths)
