import React, {Component} from 'react'
import { Grid, Image, Icon, Header, Container, Divider, Button, Loader} from 'semantic-ui-react'
import { connect } from "react-redux";

import {fetchCountStats,fetchPhotoScanStatus,fetchWordCloud,
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
  // componentDidMount() {
  //   var _dispatch = this.props.dispatch
  //   this.setState({dispatch:_dispatch})
  //   var intervalId = setInterval(function(){
  //       _dispatch(fetchPhotoScanStatus())
  //       _dispatch(fetchAutoAlbumProcessingStatus())
  //     },2000
  //   )
  //   this.setState({intervalId:intervalId})
  // }

  // componentWillUnmount() {
  //   clearInterval(this.state.intervalId)
  // }
  componentWillMount() {
    this.props.dispatch(fetchWordCloud())
  }

  // onPhotoScanButtonClick = e => {
  //   this.props.dispatch(scanPhotos())
  // }

  render() {


    return (
      <div style={{padding:10}}>
        <Header as='h2' icon textAlign='center'>
          <Header.Content>
            Statistics
            <Header.Subheader>Cool graphs about your photos library</Header.Subheader>
          </Header.Content>
        </Header>
        <Divider hidden/>
        <CountStats/>

        <Divider hidden/>


        <Grid stackable columns={2}>
          <Grid.Column>
            <LocationClusterMap height={300}/>
          </Grid.Column>
          <Grid.Column>
            <CountryPiChart/>
          </Grid.Column>
        </Grid>

        <Divider hidden/>

        <Grid stackable columns={2}>
          <Grid.Column>
            <WordCloud height={320} type='location'/>
          </Grid.Column>
          <Grid.Column>
            <WordCloud height={320} type='captions'/>
          </Grid.Column>
        </Grid>

        <Divider hidden/>
        <SocialGraph/>
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


