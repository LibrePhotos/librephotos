import React, { Component } from 'react';
import { connect } from "react-redux";
import { Image, Card, Button } from 'semantic-ui-react';
import { fetchPeople } from '../actions/peopleActions';
import { serverAddress } from '../api_client/apiClient'

export class PeopleCardGroup extends Component {
  componentWillMount() {
    this.props.dispatch(fetchPeople())
  }

  render() {
    var cards = this.props.people.map(function(person,idx){
      return (
        <PersonCard key={'person-card-'+person.text}
          name={person.text} 
          photo_count={person.face_count}
          face_url={serverAddress+person.face_url}/>
      )
    })
    return (
      <Card.Group stackable itemsPerRow={3}>
        {cards}
      </Card.Group>
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
            {this.props.photo_count} Faces
          </Card.Meta>
        </Card.Content>
        <Card.Content extra>
          <div className='ui two buttons'>
          <Button icon='remove'/>
          <Button icon='photo'/>
          </div>
        </Card.Content>
      </Card>
    )
  }
}

PeopleCardGroup = connect((store)=>{
  return {
    people: store.people.people,
    peopleFetching: store.people.fetching,
    peopleFetched: store.people.fetched,
  }
})(PeopleCardGroup)

export default PeopleCardGroup