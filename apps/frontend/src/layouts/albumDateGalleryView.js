import React, { Component } from 'react';
import { Header, Divider, Loader, Dimmer } from 'semantic-ui-react';
import Gallery from 'react-grid-gallery'
import { connect } from "react-redux";
import { fetchAlbumsDateGalleries } from '../actions/albumsActions'
import { Map, TileLayer, Marker } from 'react-leaflet'
import { serverAddress } from '../api_client/apiClient'


/*******************************************************************************
COMMON
*******************************************************************************/


export class AlbumLocationMap extends Component {
  render() {
    var photosWithGPS = this.props.photos.filter(function(photo){
      if (photo.exif_gps_lon !== null && photo.exif_gps_lon){
        return true
      }
      else {
        return false
      }
    })
    
    var sum_lat = 0
    var sum_lon = 0
    for (var i=0;i<photosWithGPS.length;i++){
      sum_lat += parseFloat(photosWithGPS[i].exif_gps_lat)
      sum_lon += parseFloat(photosWithGPS[i].exif_gps_lon)
    }
    var avg_lat = sum_lat/photosWithGPS.length
    var avg_lon = sum_lon/photosWithGPS.length

    var markers = photosWithGPS.map(function(photo,idx){
      return (
        <Marker key={'marker-'+photo.id+'-'+idx} position={[photo.exif_gps_lat, photo.exif_gps_lon]}>
        </Marker>
      )
    })
    console.log(markers)

    if (photosWithGPS.length>0){
      return (
        <div>
          <Map center={[avg_lat,avg_lon]} zoom={2}>
            <TileLayer
              attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
              url='https://{s}.tile.osm.org/{z}/{x}/{y}.png'/>
            {markers}
          </Map>
          <Divider/>
        </div>
      )
    }
    else {
      return (
        <div></div>
      )
    }
  }
}

/*******************************************************************************
AUTO GENERATED EVENT ALBUM
*******************************************************************************/

export class AlbumDateGalleryView extends Component {
  componentWillMount() {
    this.props.dispatch(fetchAlbumsDateGalleries(this.props.match.params.albumID))
  }

  render() {
    console.log(this.props)
    var albumID = this.props.match.params.albumID
    console.log('property exists',this.props.albumsDateGalleries.hasOwnProperty(albumID))
    console.log('the property',this.props.albumsDateGalleries[albumID])
    if (this.props.albumsDateGalleries.hasOwnProperty(albumID) && !this.props.fetchingAlbumsDateGalleries) {
      console.log('here!')
      console.log(this.props.albumsDateGalleries[albumID].photos)
      var mappedRenderablePhotoArray = this.props.albumsDateGalleries[albumID].photos.map(function(photo){
        return ({
          src: serverAddress+photo.image_url,
          thumbnail: serverAddress+photo.thumbnail_url,
          thumbnailWidth:photo.thumbnail_width,
          thumbnailHeight:photo.thumbnail_height,
        });
      });

      var renderable = (
        <div style={{
            display: "block",
            minHeight: "1px",
            width: "100%",
            border: "0px solid #ddd",
            overflow: "hidden"}}>
          <AlbumLocationMap photos={this.props.albumsDateGalleries[albumID].photos}/>

        <Header  as='h2' textAlign='center'>
          <Header.Content>
            {this.props.albumsDateGalleries[albumID].date}
            <Header.Subheader>{this.props.albumsDateGalleries[albumID].photos.length} Photos</Header.Subheader>
          </Header.Content>
        </Header>



          <Divider/>
          <Gallery 
            images={mappedRenderablePhotoArray}
            enableImageSelection={false}
            rowHeight={250}/>
        </div>
      )
    }
    else {
      var renderable = (
        <div>
          <Dimmer active>
            <Loader active/>
          </Dimmer>
        </div>
      )
    }
    return (
      <div>
      {renderable}
      </div>
    )
  }
}



AlbumDateGalleryView = connect((store)=>{
  return {
    fetchingAlbumsDateGalleries: store.albums.fetchingAlbumsDateGalleries,
    fetchedAlbumsDateGalleries: store.albums.fetchedAlbumsDateGalleries,
    albumsDateGalleries: store.albums.albumsDateGalleries,
  }
})(AlbumDateGalleryView)

