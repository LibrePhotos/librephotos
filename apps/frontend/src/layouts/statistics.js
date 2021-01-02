import React, {Component} from 'react'
import { Popup, Divider, Menu} from 'semantic-ui-react'
import { connect } from "react-redux";
import {CountStats} from '../components/statistics'
import WordCloud from '../components/charts/wordCloud'
import {LocationLink} from '../components/locationLink'
import {LocationClusterMap} from '../components/maps'
import EventCountMonthGraph from '../components/eventCountMonthGraph'
import LocationDurationStackedBar from '../components/locationDurationStackedBar'
import FaceClusterScatter  from '../components/faceClusterGraph'
import SocialGraph from '../components/socialGraph'


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

  // onPhotoScanButtonClick = e => {
  //   this.props.dispatch(scanPhotos())
  // }
  

  render() {
    const {activeItem} = this.state


    return (
      <div style={{padding:10}}>

        <CountStats/>

        <div>

        <Menu stackable={false} pointing secondary widths={6}>
          <Popup 
            inverted 
            position='bottom center' 
            content="Map" 
            trigger={
                <Menu.Item 
                    icon='map' 
                    active={activeItem==='map'} 
                    onClick={()=>{this.setState({activeItem:'map'})}}/>
            }/>
          <Popup 
            inverted 
            position='bottom center' 
            content="Location tree"
            trigger={
                <Menu.Item 
                    icon='sitemap' 
                    active={activeItem==='location tree'} 
                    onClick={()=>{this.setState({activeItem:'location tree'})}}/>
            }/>
          <Popup 
            inverted 
            position='bottom center' 
            content="Wordclouds" 
            trigger={
                <Menu.Item 
                    icon='cloud' 
                    active={activeItem==='wordcloud'} 
                    onClick={()=>{this.setState({activeItem:'wordcloud'})}}/>
            }/>
          <Popup 
            inverted 
            position='bottom center' 
            content="Timeline" 
            trigger={
                <Menu.Item 
                    icon='area chart' 
                    active={activeItem==='timeline'} 
                    onClick={()=>{this.setState({activeItem:'timeline'})}}/>
            }/>
          <Popup 
            inverted 
            position='bottom center' 
            content="Social graph"
            trigger={
                <Menu.Item 
                    icon='share alternate' 
                    active={activeItem==='social graph'} 
                    onClick={()=>{this.setState({activeItem:'social graph'})}}/>
            }/>
          <Popup 
            inverted 
            position='bottom center' 
            content="Face clusters"
            trigger={
                <Menu.Item 
                    icon='user circle outline' 
                    active={activeItem==='face clusters'} 
                    onClick={()=>{this.setState({activeItem:'face clusters'})}}/>
            }/>
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


