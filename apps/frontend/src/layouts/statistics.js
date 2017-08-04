import React, {Component} from 'react'
import { Grid, Image, Icon, Header, Container, Divider, Button, Loader} from 'semantic-ui-react'
import { connect } from "react-redux";

import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'
import {scanPhotos,fetchPhotos} from '../actions/photosActions'

import CountryPiChart from '../components/charts/countryPiChart'
import {CountStats} from '../components/statistics'
import WordCloud from '../components/charts/wordCloud'

import {AllPhotosMap, EventMap, LocationClusterMap} from '../components/maps'
import EventCountMonthGraph from '../components/eventCountMonthGraph'
import FaceClusterScatter  from '../components/faceClusterGraph'
import SocialGraph from '../components/socialGraph'
import LazyLoad from 'react-lazyload';

export class Statistics extends Component {
  componentDidMount() {
    var _dispatch = this.props.dispatch
    this.setState({dispatch:_dispatch})
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

  onPhotoScanButtonClick = e => {
    this.props.dispatch(scanPhotos())
  }

  render() {
    console.log(this)
    var photoScanLoadingIcon = (
      <Icon name='refresh' loading={this.props.statusPhotoScan.status}/>
    )
    return (
      <div>
        <Header as='h2' icon textAlign='center'>
          <Header.Content>
            Statistics
            <Header.Subheader>Cool graphs about your photos library</Header.Subheader>
          </Header.Content>
        </Header>
        <Divider hidden/>
        <CountStats/>
        <Button fluid color='blue' disabled={
          this.props.statusAutoAlbumProcessing.status || 
          this.props.statusPhotoScan.status ||
          this.props.scanningPhotos ||
          this.props.generatingAlbumsAuto||
          !this.props.fetchedCountStats}
          onClick={this.onPhotoScanButtonClick}>
          {photoScanLoadingIcon}Scan for more photos
        </Button>
        <Divider hidden/>
        <LocationClusterMap/>
        <Divider hidden/>

        <Grid stackable columns={2}>
          <Grid.Column>
            <WordCloud type='location'/>
          </Grid.Column>
          <Grid.Column>
            <WordCloud type='captions'/>
          </Grid.Column>
        </Grid>

        <Divider hidden/>

        <Grid stackable columns={2}>
          <Grid.Column>
            <EventCountMonthGraph/>
          </Grid.Column>
          <Grid.Column>
            <SocialGraph/>
          </Grid.Column>
        </Grid>
        
        <Divider hidden/>

        <Grid stackable columns={2}>
          <Grid.Column>
            <CountryPiChart/>
          </Grid.Column>
          <Grid.Column>
            <FaceClusterScatter/>
          </Grid.Column>
        </Grid>
        <Divider hidden/>
      </div>
    )
  }
}



Statistics = connect((store)=>{
  return {
    statusPhotoScan: store.util.statusPhotoScan,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    scanningPhotos: store.photos.scanningPhotos,
    fetchedCountStats: store.util.fetchedCountStats,
  }
})(Statistics)


