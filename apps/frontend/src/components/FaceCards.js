import React, { Component } from 'react';
import { Image, 
         Message,
         Dropdown, 
         Divider, 
         Card, 
         Container, 
         Button, 
         Icon, 
         Popup, 
         Loader, 
         Dimmer} from 'semantic-ui-react';
import { connect } from "react-redux";
import { fetchPeople, addPerson } from '../actions/peopleActions';
import { fetchFaces, deleteFace } from '../actions/facesActions';



export class FaceCards extends Component {
  componentWillMount() {
    this.props.dispatch(fetchPeople())
    this.props.dispatch(fetchFaces())
  }

  render() {
    console.log('from facecards component')
    console.log(this.props.faces)
    var mappedFaceCards = this.props.faces.map(function(face){
      return (
        <FaceCard
          key={face.id}
          face_id={face.id}
          name={face.person.name}
          face_url={"http://localhost:8000"+face.face_url}/>
      )
    })
    console.log(mappedFaceCards)
    return (
      <Container>
        <Card.Group>
          {mappedFaceCards}
        </Card.Group>
      </Container>
    )
  }
}


export class FaceCard extends Component {
  handleDeleteFace = e => {
    console.log(this.props.face_id)
    this.props.dispatch(deleteFace(this.props.face_id))
  }

  render() {
    return (
      <Card>
        <Card.Content>
          <Image 
            size="medium"
            shape='rounded'
            src={this.props.face_url} />
          <Card.Header>
            <Divider/>
            {"Who is this person?"}
          </Card.Header>
        </Card.Content>
        <Card.Content extra>
          <Popup
            trigger={<Button 
              onClick={this.handleDeleteFace}
              color='red' 
              icon='remove'/>}
            position="right center"
            content="This is not a face"
            size="tiny"
            inverted
            basic/>
          <PeopleDropDown/>
        </Card.Content>
      </Card>
    );
  }
}

export class PeopleDropDown extends Component {
  handleAddPerson = (e, {value}) => {
    console.log('trying to add',value)
    this.props.dispatch(addPerson(value))
    this.props.dispatch(fetchPeople())
  }

  render() {
    var peopleDropdownChoices = this.props.people.map(function(person){
      return (
        {key:person.id,value:person.id,text:person.name}
      )
    })

    return (
      <Dropdown  
        placeholder='Choose a Person' 
        search 
        selection 
        allowAdditions
        onAddItem={this.handleAddPerson}
        options={peopleDropdownChoices} />
    )
  } 
}

FaceCards = connect((store)=>{
  return {
    people: store.people.people,
    faces: store.faces.faces,
    userFetched:store.people.fetched,
    facesFetched:store.faces.fetched
  }
})(FaceCards)

FaceCard = connect((store)=>{
  return {
    people: store.people.people
  }
})(FaceCard)

PeopleDropDown = connect((store)=>{
  return {
    people: store.people.people
  }
})(PeopleDropDown)