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

import SocialGraph from '../components/socialGraph'
import PeopleCardGroup from '../components/people'

export class PeopleDashboard extends Component {
  render() {
    return (
      <Container>
        <Header dividing as='h2' icon textAlign='center'>
          <Header.Content>
            <Icon size='small' name='users'/>People Dashboard
            <Header.Subheader>Manage people in your photos</Header.Subheader>
          </Header.Content>
        </Header>



        <SocialGraph/>

        <Header as='h3'>People</Header>
        <PeopleCardGroup/>
      </Container>
    )
  }  
}