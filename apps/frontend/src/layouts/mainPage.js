import React, {Component} from 'react'
import { Grid, Image, Icon, Header, Container, Divider, Button, Loader} from 'semantic-ui-react'
import { connect } from "react-redux";

import {fetchCountStats,fetchPhotoScanStatus,
				fetchAutoAlbumProcessingStatus} from '../actions/utilActions'
import {scanPhotos} from '../actions/photosActions'

import {CountStats} from '../components/statistics'

export class MainPage extends Component {
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
			<Container>
				<Image size='small' src='/logo.png' centered/>
        <Header as='h2' textAlign='center'>
          Ownphotos
          <Header.Subheader>Woohoo!</Header.Subheader>
	      </Header>
	      <CountStats/>
	      <Divider/>
				<Button fluid color='blue' disabled={
					this.props.statusAutoAlbumProcessing.status || 
					this.props.statusPhotoScan.status ||
					this.props.scanningPhotos ||
					this.props.generatingAlbumsAuto||
					!this.props.fetchedCountStats}
					onClick={this.onPhotoScanButtonClick}>
					{photoScanLoadingIcon}Scan for more photos
				</Button>
			</Container>
		)
	}
}



MainPage = connect((store)=>{
  return {
    statusPhotoScan: store.util.statusPhotoScan,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    scanningPhotos: store.photos.scanningPhotos,
    fetchedCountStats: store.util.fetchedCountStats,
  }
})(MainPage)


