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
import { fetchPeople, addPerson } from '../actions/peopleActions';
import { fetchFaces, deleteFace } from '../actions/facesActions';



export class FaceCards extends Component {
  componentWillMount() {
    this.props.dispatch(fetchPeople())
    this.props.dispatch(fetchFaces())
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
        <div>
            {mappedFaceCards}
        </div>
      </div>
    )
  }
}


export class FaceCard extends Component {
  handleDeleteFace = e => {
    this.props.dispatch(deleteFace(this.props.face_id))
  }

  render() {
    return (
      <Card>
        <Card.Content>
          <Image 
            size="mini"
            shape='circular'
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
              content="This is not a face"
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
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this)
    this.handleAddPerson = this.handleAddPerson.bind(this)
    this.refetchPeopleAfterAddPerson = this.refetchPeopleAfterAddPerson.bind(this)
    this.state = {
      options: props.people
    }
  }

  refetchPeopleAfterAddPerson() {
    this.props.dispatch(fetchPeople())    
    this.props.dispatch(fetchPeople())    
  }

  handleAddPerson = (e, {value}) => {
    this.props.dispatch(addPerson(value))
    this.refetchPeopleAfterAddPerson()
    this.currentValue = value
    console.log("right after person add, is it adding?",this.props.personAdding)
  }

  handleChange = (e, {value}) => {
    this.currentValue = value
  }

  componentDidUpdate(nextProps) {
    console.log('inside componentDidUpdate')
    if (nextProps.people !== this.props.people) {
      console.log(nextProps)
      console.log('setting state to nextprops')
      this.setState({
        options: nextProps.people
      })
    }
  }

  render() {
    this.state = {
      options: this.props.people
    }
    console.log(this.props)
    console.log('dropdown rendering')
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
        options={this.state.options} />
    )
  } 
}

FaceCards = connect((store)=>{
  return {
    faces: store.faces.faces,
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
    people: store.people.people,
    peopleFetching: store.people.fetching,
    personAdding: store.people.adding,
  }
})(PeopleDropDown)
