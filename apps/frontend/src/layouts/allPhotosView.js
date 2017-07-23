import React, {Component} from 'react';
import { Card, Image, Header, Divider, Item, Loader, Dimmer,
         Container, Label, Popup, Segment, Button, Icon} from 'semantic-ui-react';
import Gallery from 'react-grid-gallery'
import VisibilitySensor from 'react-visibility-sensor'
import { connect } from "react-redux";
import {
  BrowserRouter as Router,
  Route,
  Link
} from 'react-router-dom'
import {fetchPhotos} from '../actions/photosActions'
import { Map, TileLayer, Marker } from 'react-leaflet'
import {Server, serverAddress} from '../api_client/apiClient'

        // <div style={{
        //     display: "block",
        //     minHeight: "1px",
        //     width: "100%",
        //     padding: '10px',
        //     overflowX: "hidden",
        //     overflowY: 'auto'}}>
        //   <Gallery 
        //     images={mappedRenderablePhotoArray}
        //     enableImageSelection={false}
        //     rowHeight={250}/>
        // </div>


export class AllPhotosView extends Component {
	constructor(props){
		super(props)
	}

	componentWillMount() {
		this.props.dispatch(fetchPhotos())
	}

	render() {
		console.log(this.props.photos)
		if (this.props.fetchedPhotos && !this.props.photos.length==0 && !this.props.fetchingPhotos) {

      var mappedRenderablePhotoArray = this.props.photos.map(function(photo){
        return ({
          src: serverAddress+photo.image_url,
          thumbnail: serverAddress+photo.thumbnail_url,
          thumbnailWidth:photo.thumbnail_width,
          thumbnailHeight:photo.thumbnail_height,
        });
      });


			var mappedImages = this.props.photos.map(function(photo){
				return (
					<Image 
						src={serverAddress+photo.square_thumbnail_url}/>
				)
			})
			var renderable = (
				<Image.Group size='small'>
					{mappedImages}
				</Image.Group>
			)
		}
		else {
			var renderable = (
				<Dimmer active>
					<Loader active/>
				</Dimmer>
			)
		}
		return (
			<div>{renderable}</div>
		)
	}
}




AllPhotosView = connect((store)=>{
  return {
  	fetchedPhotos: store.photos.fetchedPhotos,
  	fetchingPhotos: store.photos.fetchingPhotos,
  	photos: store.photos.photos,  	
  }
})(AllPhotosView)
