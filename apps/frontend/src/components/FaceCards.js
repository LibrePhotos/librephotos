import React, { Component } from 'react';
import { Image, 
         Header,
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
import { fetchPeople, 
         addPerson } from '../actions/peopleActions';
import { fetchFaces, 
         deleteFace, 
         labelFacePerson ,
         fetchFaceToLabel} from '../actions/facesActions';

export class FaceCards extends Component {
  componentWillMount() {
    this.props.dispatch(fetchFaces())
    this.props.dispatch(fetchPeople())
  }

  render() {
    var mappedFaceCards = this.props.faces.map(function(face){
      return (
        <FaceCard
          key={face.id}
          face_id={face.id}
          name={face.person.name}
          face_url={"http://localhost:8000"+face.face_url}/>
      )
    })
    return (
      <div>
        <Button>Train</Button>
        <Card.Group>
            {mappedFaceCards}
        </Card.Group>
      </div>
    )
  }
}

export class FaceToLabel extends Component {
  componentWillMount() {
    this.props.dispatch(fetchFaceToLabel())
    this.props.dispatch(fetchPeople())
  }

  render() {
    console.log(this.props)
    return (
      <div>
        <Button>Train</Button>
        <Card.Group>
          <FaceCard
            key={this.props.faceToLabel.id}
            face_id={this.props.faceToLabel.id}
            name={"hello"}
            face_url={"http://localhost:8000"+this.props.faceToLabel.face_url}/>
        </Card.Group>
      </div>
    )
  }
}


export class FaceCard extends Component {
  handleDeleteFace = e => {
    this.props.dispatch(deleteFace(this.props.face_id))
  }
  handleNextFace = e => {
    this.props.dispatch(fetchFaceToLabel())    
  }

  render() {
    return (
      <Card>
        <Card.Content>
          <Image 
            height={260}
            width={260}
            shape='rounded'
            src={this.props.face_url} />
          <Card.Header>
            <Divider/>
            {"Who is this person?"}
          </Card.Header>
        </Card.Content>
        <Card.Content extra>
          <PeopleDropDown face_id={this.props.face_id}/>
          <Divider/>
          <div className='ui two buttons'>
            <Popup
              trigger={<Button 
                basic
                onClick={this.handleDeleteFace}
                color='red' 
                icon='remove'/>}
              position="top center"
              content="Forget this face"
              size="tiny"
              inverted
              basic/>
            <Popup
              trigger={<Button 
                basic
                onClick={this.handleNextFace}
                color='green' 
                icon='checkmark'/>}
              position="top center"
              content="Submit label"
              size="tiny"
              inverted
              basic/>
          </div>
        </Card.Content>
      </Card>
    );
  }
}

export class PeopleDropDown extends Component {
  handleAddPerson = (e, {value}) => {
    console.log('handing add')
    this.props.dispatch(labelFacePerson(this.props.face_id,value))
    this.currentValue = value
  }

  handleChange = (e, {value}) => {
    console.log('handing change')
    this.currentValue = value
    this.props.dispatch(labelFacePerson(this.props.face_id,value))
  }

  render() {
    return (
      <Dropdown  
        placeholder='Choose Person' 
        search 
        fluid
        selection 
        allowAdditions
        loading={this.props.personAdding || this.props.peopleFetching}
        onAddItem={this.handleAddPerson}
        onChange={this.handleChange}
        options={this.props.people} />
    )
  } 
}

FaceToLabel = connect((store)=>{
  return {
    faceToLabel: store.faces.faceToLabel,
    facesFetched:store.faces.fetched
  }
})(FaceToLabel)

FaceCards = connect((store)=>{
  return {
    faces: store.faces.faces,
    faceToLabel: store.faces.faceToLabel,
    facesFetched:store.faces.fetched
  }
})(FaceCards)

FaceCard = connect((store)=>{
  return {
    faces: store.faces.faces,
    faceToLabel: store.faces.faceToLabel,
  }
})(FaceCard)

PeopleDropDown = connect((store)=>{
  return {
    faceToLabel: store.faces.faceToLabel,
    people: store.people.people,
    peopleFetching: store.people.fetching,
    personAdding: store.people.adding,
  }
})(PeopleDropDown)
