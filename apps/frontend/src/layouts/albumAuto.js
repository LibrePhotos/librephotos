import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums} from '../actions/albumsActions'
import {AlbumAutoCard, AlbumAutoGallery} from '../components/album'
import {Container, Icon, Header, Button, Card, Label, Popup} from 'semantic-ui-react'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'


export class AlbumAuto extends Component {
  componentWillMount() {
    this.props.dispatch(fetchAutoAlbums())
    var _dispatch = this.props.dispatch
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


  handleAutoAlbumGen = e => this.props.dispatch(generateAutoAlbums())

  render() {
    if (this.props.fetchedAlbumsAuto) {
      var match = this.props.match
      var mappedAlbumCards = this.props.albumsAuto.map(function(album){
        var albumTitle = album.title
        var albumDate = album.timestamp.split('T')[0]
        try {
          var albumCoverURL = album.photos[0].square_thumbnail_url
        }
        catch(err) {
          console.log(err)
          var albumCoverURL = null
        }
        return (

          <AlbumAutoCard 
            match={match}
            key={'album-auto-'+album.id}
            albumTitle={albumTitle}
            timestamp={albumDate}
            people={album.people}
            album_id={album.id}
            albumCoverURL={'http://localhost:8000'+albumCoverURL}
            photoCount={album.photos.length}/>
        )
      })
    }
    else {
      var mappedAlbumCards = null
    }


    return (
      <Container fluid>
        <div style={{width:'100%', textAlign:'center', paddingTop:'20px'}}>
          <Icon.Group size='huge'>
            <Icon inverted circular name='image'/>
            <Icon inverted circular corner name='wizard'/>
          </Icon.Group>
        </div>
        <Header dividing as='h2' icon textAlign='center'>
          <Header.Content>
            Events
            <Header.Subheader>View automatically generated event albums</Header.Subheader>
          </Header.Content>
        </Header>

        <div style={{paddingBottom:'20px'}}>

          <Button 
            onClick={this.handleAutoAlbumGen}
            loading={this.props.statusAutoAlbumProcessing.status}
            disabled={
              this.props.statusAutoAlbumProcessing.status||
              this.props.statusPhotoScan.status||
              this.props.generatingAlbumsAuto||
              this.props.scanningPhotos
            }
            fluid 
            color='blue'>
            <Icon name='wizard'/>Generate More
          </Button>

        </div>

        <Card.Group stackable itemsPerRow={4}>
        {mappedAlbumCards}
        </Card.Group>
      </Container>
    )
  }
}





AlbumAuto = connect((store)=>{
  return {
    albumsAuto: store.albums.albumsAuto,
    fetchingAlbumsAuto: store.albums.fetchingAlbumsAuto,
    fetchedAlbumsAuto: store.albums.fetchedAlbumsAuto,
    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    generatedAlbumsAuto: store.albums.generatedAlbumsAuto,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    statusPhotoScan: store.util.statusPhotoScan,
    scanningPhotos: store.photos.scanningPhotos,
  }
})(AlbumAuto)
