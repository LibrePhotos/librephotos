import React, { Component } from 'react';
import { connect } from "react-redux";
import { Image, Header, Dropdown, Divider, Card, 
         Container, Button, Icon, Popup, Loader, 
         Dimmer, Statistic, Label, Table } from 'semantic-ui-react';
import { fetchPeople, 
         addPerson } from '../actions/peopleActions';
import { fetchFaces, 
         fetchLabeledFaces,
         fetchInferredFaces,
         deleteFaceAndFetchNext, 
         fetchFaceToLabel,
         loadFaceToLabel,
         trainFaces,
         labelFacePersonAndFetchNext} from '../actions/facesActions';
import { serverAddress} from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';


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
      <LazyLoad threshold
        height={60} 
        width={60} 
        placeholder={
          <Image height={60} width={60} avatar
            shape='rounded' src={'/unknown_user.jpg'}/>
        }>
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
      </LazyLoad>
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
            face_url={serverAddress+face.face_url}
            face_id={face.id}/>        
        )
      })
      return (
        <Table.Row key={"table-row-labeled-"+person_name}>
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
            face_url={serverAddress+face.face_url}
            face_id={face.id}/>        
        )
      })
      return (
        <Table.Row key={"table-row-inferred-"+person_name}>
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
            face_url={serverAddress+face.face_url}
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
            face_url={serverAddress+face.face_url}
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
          face_url={serverAddress+face.face_url}/>
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
          <FaceCard
            card_loading={this.props.faceToLabelFetching}
            key={this.props.faceToLabel.id}
            face_id={this.props.faceToLabel.id}
            name={"hello"}
            image_hash={this.props.faceToLabel.photo}
            person_label_probability={this.props.faceToLabel.person_label_probability}
            face_url={this.props.faceToLabel.image}/>
    )
  }
}


export class FaceCard extends Component {
  state = { modalOpen: false }
  handleOpen = () => this.setState({ modalOpen: true })
  handleClose = () => this.setState({ modalOpen: false })

  render() {
    let image = null;
    if (this.props.card_loading){
      image = (
        <div>
          <Dimmer active inverted>
            <Loader inverted />
          </Dimmer>
          <Image
            src={'/unknown_user.jpg'}
            floated='right'
            hidden
            height={70}
            width={70}
            shape='rounded'/>
        </div>
      )
    }
    else {
      image = <Image 
        style={{borderRadius:'1em'}}
        floated='right'
        height={70}
        width={70}
        shape='rounded'
        src={this.props.face_url} />
    }

    if (this.props.face_id == null){
      return (
          <Card fluid style={{height:220}}>
            <Card.Content>
              <Card.Header>
                {image}
                {"No more face to label!"}
              </Card.Header>
            </Card.Content>
            <Card.Content extra>
              <FaceCardMenu face_id={this.props.face_id}/>
            </Card.Content>
          </Card>      
      )
    }

    return (
      <div>
        <Card fluid style={{height:220}}>
          <Card.Content>
            <Card.Header>
              {image}
              {"Who is this person?"}
            </Card.Header>
          </Card.Content>
          <Card.Content extra>
            <FaceCardMenu face_id={this.props.face_id} image_hash={this.props.image_hash}/>
          </Card.Content>
        </Card>


      </div>
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
    if (this.props.face_id == null){
      var buttonGroup = (
          <Popup
            trigger={<Button 
              color='green'
              fluid 
              icon='star'/>}
            position="top center"
            content="Woohoo!"
            size="tiny"
            inverted
            basic/>
      )
    }
    else {
      var buttonGroup = (
        <div className='ui four buttons'>
          <Popup
            trigger={<Button 
              onClick={this.handleDeleteFace}
              color='red' 
              icon='trash'/>}
            position="top center"
            content="Forget this face"
            size="tiny"
            inverted
            basic/>

          <Popup 
            trigger={
              <Button 
              color='orange' 
              icon='photo'/>
            }
            on='hover'
            flowing
            hideOnScroll
            position="bottom center"
            content={<Image size='large' src={serverAddress+'/media/thumbnails_big/'+this.props.image_hash+'.jpg'}/>}/>
        
          <Popup 
            trigger={
              <Button fluid
                loading={this.props.training} 
                color='blue'  
                onClick={()=>{this.props.dispatch(trainFaces())}}>
                <Icon name='lightning'/>
              </Button>
            }
            inverted
            size="tiny"
            position="top center"
            content="Train the classifier"/>    

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
      )
    }

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
          {buttonGroup}
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
    training: store.faces.training
  }
})(FaceCard)

FaceCardMenu = connect((store)=>{
  return {
    training: store.faces.training,
    faceToLabel: store.faces.faceToLabel,
    people: store.people.people,
    peopleFetching: store.people.fetching,
    personAdding: store.people.adding,
  }
})(FaceCardMenu)
