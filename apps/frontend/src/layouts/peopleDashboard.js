import React, { Component } from 'react';
import {  Header, Container, Icon } from 'semantic-ui-react';
import SocialGraph from '../components/socialGraph'
import PeopleCardGroup from '../components/people'


export class PeopleDashboard extends Component {
  render() {
    return (
      <Container fluid>
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