import React, { Component } from 'react';
import { Image, 
         Header,
         Message,
         Dropdown, 
         Divider, 
         Card, 
         Container, 
         Segment,
         Button, 
         Icon, 
         Popup, 
         Loader, 
         Dimmer} from 'semantic-ui-react';
import { connect } from "react-redux";
import { fetchPeople, 
         addPerson ,
         addPersonAndSetLabelToFace} from '../actions/peopleActions';
import { fetchFaces, 
         deleteFace, 
         labelFacePerson ,
         fetchFaceToLabel,
         labelFacePersonAndFetchNext} from '../actions/facesActions';

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
        <Card.Group>
          <FaceCard
            card_loading={this.props.faceToLabelFetching}
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

  render() {
    let image = null;
    if (this.props.card_loading){
      image = (
        <div>
          <Dimmer active inverted>
            <Loader inverted />
          </Dimmer>
          <Image 
            hidden
            height={20}
            width={20}
            shape='rounded'/>
        </div>
      )
    }
    else {
      image = <Image 
        height={20}
        width={20}
        shape='rounded'
        src={this.props.face_url} />
    }

    return (
      <Card>
        <Card.Content>
          {image}
          <Card.Header>
            <Divider/>
            {"Who is this person?"}
          </Card.Header>
        </Card.Content>
        <Card.Content extra>
          <PersonSelector face_id={this.props.face_id}/>
        </Card.Content>
      </Card>
    );
  }
}

export class PersonSelector extends Component {
  handleAddPerson = (e, {value}) => {
    console.log('handing add', value, this.props.face_id)
    this.props.dispatch(addPerson(value))
    this.currentValue = value
  }

  handleChange = (e, {value}) => {
    console.log('handing change')
    this.currentValue = value
  }

  handleDeleteFace = e => {
    this.props.dispatch(deleteFace(this.props.face_id))
  }

  handleSubmit = e => {
    this.props.dispatch(labelFacePersonAndFetchNext(this.props.face_id,this.currentValue))
  }

  render() {
    return (
      <div>
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
                onClick={this.handleSubmit}
                color='green' 
                icon='checkmark'/>}
              position="top center"
              content="Submit label and show next face"
              size="tiny"
              inverted
              basic/>
          </div>
        </div>
    )
  } 
}

FaceToLabel = connect((store)=>{
  return {
    faceToLabel: store.faces.faceToLabel,
    facesFetched:store.faces.fetched,
    faceToLabelFetching: store.faces.fetchingFaceToLabel,
    faceToLabelFetched: store.faces.fetchedFaceToLabel,
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
    people: store.people.people,
    peopleFetching: store.people.fetching,
  }
})(FaceCard)

PersonSelector = connect((store)=>{
  return {
    faceToLabel: store.faces.faceToLabel,
    people: store.people.people,
    peopleFetching: store.people.fetching,
    personAdding: store.people.adding,
  }
})(PersonSelector)
