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
import VisibilitySensor from 'react-visibility-sensor'


export class FaceStatistics extends Component {
  render() {
    return (
      <Statistic.Group size='mini'>
        <Statistic>
          <Statistic.Value>{this.props.labeledFaces.length}</Statistic.Value>
          <Statistic.Label>Labelled</Statistic.Label>
        </Statistic>
        <Statistic>
          <Statistic.Value>{this.props.inferredFaces.length}</Statistic.Value>
          <Statistic.Label>Inferred</Statistic.Label>
        </Statistic>
      </Statistic.Group>
    )
  }
}


export class EditableFaceIcon extends Component {
  state = {}

  handleShow = () => this.setState({ active: true })
  handleHide = () => this.setState({ active: false })
  handleClick = () => this.props.dispatch(loadFaceToLabel(this.props.face))

  render() {
    const { active } = this.state
    const content = (
      <Icon link color='black' name='write' onClick={this.handleClick}/>
    )
    return (
      <VisibilitySensor>
        <Popup
          inverted
          trigger={
            <Dimmer.Dimmable 
              as={Image}
              height={60}
              width={60}
              avatar
              dimmed={active}
              shape='rounded'
              dimmer={{ active, content, inverted:true}}
              onMouseEnter={this.handleShow}
              onMouseLeave={this.handleHide}
              src={this.props.face_url}/>}
            content={this.props.person_name}/>
      </VisibilitySensor>
    )
  }
}

export class FaceTableLabeled extends Component{
  componentWillMount() {
    this.props.dispatch(fetchLabeledFaces())
  }
  render() {
    var person_names = [... new Set(this.props.labeledFaces.map(function(face){return face.person.name}))]
    var faces = this.props.labeledFaces
    var mappedRows = person_names.map(function(person_name){
      var thisPersonsFaces = faces.filter(function(face){
        return person_name===face.person.name
      })
      var mappedFaceIcons = thisPersonsFaces.map(function(face){
        return (
          <EditableFaceIcon
            key={face.id}
            face={face}
            person_name={face.person.name}
            face_url={"http://localhost:8000"+face.face_url}
            face_id={face.id}/>        
        )
      })
      return (
        <Table.Row>
          <Table.Cell width={3}>{person_name}</Table.Cell>
          <Table.Cell>{mappedFaceIcons}</Table.Cell>
        </Table.Row>
      )
    })
    return (
      <Table compact celled selectable>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Person</Table.HeaderCell>
            <Table.HeaderCell>Faces</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {mappedRows}
        </Table.Body>
      </Table>
    )
  }
}

export class FaceTableInferred extends Component{
  componentWillMount() {
    this.props.dispatch(fetchInferredFaces())
  }
  render() {
    var person_names = [... new Set(this.props.inferredFaces.map(function(face){return face.person.name}))]
    var faces = this.props.inferredFaces
    var mappedRows = person_names.map(function(person_name){
      var thisPersonsFaces = faces.filter(function(face){
        return person_name===face.person.name
      })
      var mappedFaceIcons = thisPersonsFaces.map(function(face){
        return (
          <EditableFaceIcon
            key={face.id}
            face={face}
            person_name={face.person.name}
            face_url={"http://localhost:8000"+face.face_url}
            face_id={face.id}/>        
        )
      })
      return (
        <Table.Row>
          <Table.Cell width={3}>{person_name}</Table.Cell>
          <Table.Cell>{mappedFaceIcons}</Table.Cell>
        </Table.Row>
      )
    })
    return (
      <Table compact celled selectable >
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Person</Table.HeaderCell>
            <Table.HeaderCell>Faces</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {mappedRows}
        </Table.Body>
      </Table>
    )
  }
}



export class FacesLabeled extends Component {
  componentWillMount() {
    this.props.dispatch(fetchLabeledFaces())
  }
  render() {
    var mappedFaceCards = this.props.labeledFaces.map(function(face){
      return (
          <EditableFaceIcon
            key={face.id}
            person_name={face.person.name}
            face_url={"http://localhost:8000"+face.face_url}
            face_id={face.id}/>
      )
    })
    return (
      <Container>
        <Header dividing as='h2'>
          Labeled Faces
          <Label>
            <Icon name='user circle outline' />{this.props.labeledFaces.length}
          </Label>
        </Header>
        {mappedFaceCards}
      </Container>
    )
  }
}

export class FacesInferred extends Component {
  componentWillMount() {
    this.props.dispatch(fetchInferredFaces())
  }
  render() {
    var mappedFaceCards = this.props.inferredFaces.map(function(face){
      return (
          <EditableFaceIcon
            key={face.id}
            person_name={face.person.name}
            face_url={"http://localhost:8000"+face.face_url}
            face_id={face.id}/>
      )
    })
    return (
      <Container>
        <Header dividing as='h2'>
          Inferred Faces
          <Label>
            <Icon name='user circle outline' />{this.props.inferredFaces.length}
          </Label>
        </Header>
        {mappedFaceCards}
      </Container>
    )
  }
}


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
            floated='right'
            hidden
            height={50}
            width={50}
            shape='rounded'/>
        </div>
      )
    }
    else {
      image = <Image 
        floated='right'
        height={50}
        width={50}
        shape='rounded'
        src={this.props.face_url} />
    }

    return (
      <Card fluid>
        <Card.Content>
          <Card.Header>
            {image}
            {"Who is this person?"}
          </Card.Header>
        </Card.Content>
        <Card.Content extra>
          <FaceCardMenu face_id={this.props.face_id}/>
        </Card.Content>
      </Card>
    );
  }
}

export class FaceCardMenu extends Component {
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
    this.props.dispatch(deleteFaceAndFetchNext(this.props.face_id))
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
          <div className='ui three buttons'>
            <Popup
              trigger={<Button 
                onClick={this.handleDeleteFace}
                color='red' 
                icon='remove'/>}
              position="top center"
              content="Forget this face"
              size="tiny"
              inverted
              basic/>

            <Modal 
              basic
              trigger={
                <Button 
                color='orange' 
                icon='photo'/>
              }>
              <Modal.Header>
                <Image fluid src={`http://localhost:8000/media/photos/${this.props.faceToLabel.photo_id}.jpg`}/>
              </Modal.Header>
            </Modal>

            <Popup
              trigger={<Button 
                onClick={this.handleSubmit}
                color='green' 
                icon='plus'/>}
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

EditableFaceIcon = connect((store)=>{
  return {
    faceToLabel: store.faces.faceToLabel
  }
})(EditableFaceIcon)

FaceTableInferred = connect((store)=>{
  return {
    inferredFaces: store.faces.inferredFaces
  }
})(FaceTableInferred)

FaceTableLabeled = connect((store)=>{
  return {
    labeledFaces: store.faces.labeledFaces,
  }
})(FaceTableLabeled)

FaceStatistics = connect((store)=>{
  return {
    labeledFaces: store.faces.labeledFaces,
    inferredFaces: store.faces.inferredFaces
  }
})(FaceStatistics)

FacesLabeled = connect((store)=>{
  return {
    labeledFaces: store.faces.labeledFaces,
    fetchingLabeledFaces: store.faces.fetchingLabeledFaces,
    fetchedLabeledFaces: store.faces.fetchedLabeledFaces
  }
})(FacesLabeled)

FacesInferred = connect((store)=>{
  return {
    inferredFaces: store.faces.inferredFaces,
    fetchingInferredFaces: store.faces.fetchingInferredFaces,
    fetchedInferredFaces: store.faces.fetchedInferredFaces
  }
})(FacesInferred)

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

FaceCardMenu = connect((store)=>{
  return {
    faceToLabel: store.faces.faceToLabel,
    people: store.people.people,
    peopleFetching: store.people.fetching,
    personAdding: store.people.adding,
  }
})(FaceCardMenu)
