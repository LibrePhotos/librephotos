import React, {Component} from 'react'
import { Segment, Grid, Image, Icon, Header, Container, Divider, Button, Loader, Menu} from 'semantic-ui-react'
import { connect } from "react-redux";

import {fetchCountStats,fetchPhotoScanStatus,fetchWordCloud,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'
import {scanPhotos,fetchPhotos} from '../actions/photosActions'

import CountryPiChart from '../components/charts/countryPiChart'
import {CountStats} from '../components/statistics'
import WordCloud from '../components/charts/wordCloud'
import {LocationLink} from '../components/locationLink'

import {AllPhotosMap, EventMap, LocationClusterMap} from '../components/maps'
import EventCountMonthGraph from '../components/eventCountMonthGraph'
import LocationDurationStackedBar from '../components/locationDurationStackedBar'

import FaceClusterScatter  from '../components/faceClusterGraph'
import SocialGraph from '../components/socialGraph'
import LazyLoad from 'react-lazyload';

export class Statistics extends Component {

  state = { activeItem: 'map' }

  handleItemClick = (e, { name }) => this.setState({ activeItem: name })

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
    const {activeItem} = this.state

    console.log(activeItem)

    return (
      <div style={{padding:10}}>
        <Divider hidden/>
        <CountStats/>

        <Divider hidden/>
        <div>

        <Menu stackable pointing secondary widths={6}>
          <Menu.Item name='map' active={activeItem==='map'} onClick={this.handleItemClick}/>
          <Menu.Item name='location tree' active={activeItem==='location tree'} onClick={this.handleItemClick}/>
          <Menu.Item name='wordcloud' active={activeItem==='wordcloud'} onClick={this.handleItemClick}/>
          <Menu.Item name='timeline' active={activeItem==='timeline'} onClick={this.handleItemClick}/>
          <Menu.Item name='social graph' active={activeItem==='social graph'} onClick={this.handleItemClick}/>
          <Menu.Item name='face clusters' active={activeItem==='face clusters'} onClick={this.handleItemClick}/>
        </Menu>

        </div>




        { activeItem==='location tree' && (
            <div>
                <Divider hidden/>
                <LocationLink width={window.innerWidth-120} height={window.innerHeight - 50}/>
            </div>
        )}

        { activeItem==='map' && (
            <div style={{paddingTop:10}}>
                <LocationClusterMap height={window.innerHeight-250}/>
            </div>
        )}

        { activeItem==='wordcloud' && (
            <div>
                <Divider hidden/>
                <WordCloud height={320} type='location'/>
                <Divider hidden/>
                <WordCloud height={320} type='captions'/>
                <Divider hidden/>
                <WordCloud height={320} type='people'/>
            </div>
        )}

        { activeItem==='timeline' && (
            <div>
                <Divider hidden/>
                <EventCountMonthGraph />
                <Divider hidden/>
                <LocationDurationStackedBar/>
            </div>
        )}

        { activeItem==='social graph' && (
            <div>
                <Divider hidden/>
                <SocialGraph height={window.innerHeight - 300}/>
            </div>
        )}

        { activeItem==='face clusters' && (
            <div>
                <Divider hidden/>
                <FaceClusterScatter height={window.innerHeight-320}/>
            </div>
        )}
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


