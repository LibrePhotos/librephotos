import React, { Component } from 'react';
import { connect } from "react-redux";
import { Image, Header, Message, Dropdown, Divider, Card, 
         Container, Segment, Button, Icon, Popup, Loader, 
         Dimmer, Grid, Reveal, Statistic, Label, Table,
         Modal } from 'semantic-ui-react';
import { fetchPeople, 
         addPerson ,
         addPersonAndSetLabelToFace} from '../actions/peopleActions';
import { fetchFaces, 
         fetchLabeledFaces,
         fetchInferredFaces,
         deleteFaceAndFetchNext, 
         labelFacePerson ,
         fetchFaceToLabel,
         loadFaceToLabel,
         labelFacePersonAndFetchNext} from '../actions/facesActions';

import SocialGraph from './socialGraph'

export class PeopleCardGroup extends Component {
  componentWillMount() {
    this.props.dispatch(fetchPeople())
  }

  render() {
    var cards = this.props.people.map(function(person){
      return (
        <PersonCard 
          name={person.text} 
          photo_count={10}
          face_url={"http://localhost:8000"+person.face_url}/>
      )
    })
    return (
      <Container>
        <Grid stackable columns={2}> 
          <Grid.Column width={5}>
          </Grid.Column>
          <Grid.Column width={11}>
            <Segment><SocialGraph/></Segment>
          </Grid.Column>
        </Grid>
        <Card.Group stackable itemsPerRow={3}>
          {cards}
        </Card.Group>
      </Container>
    )
  }
}

export class PersonCard extends Component {
  render() {
    return (
      <Card>
        <Card.Content>
          <Image 
            floated='right' 
            src={this.props.face_url} 
            height={60}
            width={60}
            shape='rounded'/>
          <Card.Header>
            {this.props.name}
          </Card.Header>
          <Card.Meta>
            {this.props.photo_count} Photos
          </Card.Meta>
        </Card.Content>
      </Card>
    );
  }
}

PeopleCardGroup = connect((store)=>{
  return {
    people: store.people.people,
    peopleFetching: store.people.fetching,
    peopleFetched: store.people.fetched,
  }
})(PeopleCardGroup)