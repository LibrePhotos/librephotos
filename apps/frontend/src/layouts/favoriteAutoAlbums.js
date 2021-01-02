import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchAutoAlbumsList } from '../actions/albumsActions'
import { AlbumAutoCard } from '../components/album'
import { Container, Icon, Header, Card } from 'semantic-ui-react'
import { serverAddress } from '../api_client/apiClient'


export class FavoriteAutoAlbumsView extends Component {
	constructor(props){
		super(props)
		this.filterFavoriteAutoAlbums = this.filterFavoriteAutoAlbums.bind(this)
	}

	componentWillMount(){
		if (this.props.albumsAutoList.length==0){
			this.props.dispatch(fetchAutoAlbumsList())
		} 
	}

	filterFavoriteAutoAlbums(){
		var favoriteAutoAlbums = this.props.albumsAutoList.filter(function(album){
			if (album.favorited){
				return true
			}
			else {
				return false
			}
		})
		return favoriteAutoAlbums
	}



	render() {
		var favoriteAutoAlbums = this.filterFavoriteAutoAlbums()
		console.log(favoriteAutoAlbums)

		var match = this.props.match
		var mappedFavoriteAutoAlbumCard = favoriteAutoAlbums.map(function(album){
      var albumTitle = album.title
      var albumDate = album.timestamp.split('T')[0]
      try {
        var albumCoverURL = album.cover_photo_url
      }
      catch(err) {
        console.log(err)
        var albumCoverURL = null
      }
			return (
        <AlbumAutoCard 
        	match={match}
          key={'album-auto-favorite-'+album.id+'-'+album.favorited}
          albumTitle={albumTitle}
          timestamp={albumDate}
          people={album.people}
          favorited={album.favorited}
          album_id={album.id}
          albumCoverURL={serverAddress+albumCoverURL}
          photoCount={album.photo_count}/>
			)
		})
		return (
			<Container fluid>
        <div style={{width:'100%', textAlign:'center'}}>
          <Icon.Group size='huge'>
            <Icon inverted circular name='heart' color='pink'/>
            <Icon inverted circular corner name='wizard'/>
          </Icon.Group>
        </div>
        <Header as='h2' icon textAlign='center'>
          <Header.Content>
            Favorite Events
            <Header.Subheader>View your favorite automatically generated event albums</Header.Subheader>
            <Header.Subheader>{mappedFavoriteAutoAlbumCard.length} Favorites</Header.Subheader>
          </Header.Content>
        </Header>
				<Card.Group itemsPerRow={5} stackable>
					{mappedFavoriteAutoAlbumCard}
				</Card.Group>
			</Container>
		)
	}
}



FavoriteAutoAlbumsView = connect((store)=>{
  return {
    albumsAuto: store.albums.albumsAuto,
    fetchingAlbumsAuto: store.albums.fetchingAlbumsAuto,
    fetchedAlbumsAuto: store.albums.fetchedAlbumsAuto,
    
    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,

    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    generatedAlbumsAuto: store.albums.generatedAlbumsAuto,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    statusPhotoScan: store.util.statusPhotoScan,
    scanningPhotos: store.photos.scanningPhotos,

  }
})(FavoriteAutoAlbumsView)
