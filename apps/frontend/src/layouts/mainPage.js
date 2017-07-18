import React, {Component} from 'react'
import { Grid, Image, Icon, Header, Container, Divider, Button, Loader} from 'semantic-ui-react'
import { connect } from "react-redux";

import {fetchCountStats,fetchPhotoScanStatus,
				fetchAutoAlbumProcessingStatus} from '../actions/utilActions'
import {CountStats} from '../components/statistics'

export class MainPage extends Component {
	componentDidMount() {
		var _dispatch = this.props.dispatch
		setInterval(function(){
				_dispatch(fetchPhotoScanStatus())
				_dispatch(fetchAutoAlbumProcessingStatus())
			},10000
		)
	}

	render() {
		console.log(this)
		return (
			<Container>
				<Image size='tiny' src='/logo.png' centered/>
        <Header as='h2' textAlign='center'>
          Ownphotos
          <Header.Subheader>Woohoo!</Header.Subheader>
	      </Header>
	      <CountStats/>
	      <Divider/>
				<Button fluid color='blue' >
					<Icon name='refresh'/>Scan for more photos
				</Button>

				{JSON.stringify(this.props.statusPhotoScan)}
				{JSON.stringify(this.props.statusAutoAlbumProcessing)}

			</Container>
		)
	}
}



MainPage = connect((store)=>{
  return {
    statusPhotoScan: store.util.statusPhotoScan,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
  }
})(MainPage)


