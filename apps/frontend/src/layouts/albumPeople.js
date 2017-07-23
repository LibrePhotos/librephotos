import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums} from '../actions/albumsActions'
import {AlbumPeopleCard, AlbumPeopleGallery} from '../components/album'
import {Container, Icon, Divider, Header, Button, Card} from 'semantic-ui-react'
import { fetchPeople } from '../actions/peopleActions';

import {Server, serverAddress} from '../api_client/apiClient'



export class AlbumPeople extends Component {
  componentWillMount() {
    if (this.props.people.length == 0){
      this.props.dispatch(fetchPeople())
    }
  }
  render() {
    if (this.props.fetchedPeople) {
      var match = this.props.match
      var people = this.props.people
      var mappedAlbumCards = people.map(function(person){
        return (
          <AlbumPeopleCard
            match={match}
            key={'album-person-'+person.key}
            person={person}/>
        )
      })
    }
    else {
      var mappedAlbumCards = null
    }
    console.log(this.props)
    return (
      <Container fluid>
        <div style={{width:'100%', textAlign:'center'}}>
          <Icon.Group size='huge'>
            <Icon circular inverted name='image'/>
            <Icon circular inverted corner name='users'/>
          </Icon.Group>
        </div>
        <Header as='h1' textAlign='center'>
          <Header.Content>
            People
            <Header.Subheader>See photos grouped by people</Header.Subheader>
          </Header.Content>
        </Header>
        <Divider hidden/>

        <Card.Group stackable itemsPerRow={5}>
          {mappedAlbumCards}
        </Card.Group>
      </Container>
    )
  }
}


AlbumPeople = connect((store)=>{
  return {
    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
    people: store.people.people,
    fetchedPeople: store.people.fetched,
    fetchingPeople: store.people.fetching,
  }
})(AlbumPeople)