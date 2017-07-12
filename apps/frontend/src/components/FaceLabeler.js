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
import axios from "axios";


var Server = axios.create({
  baseURL: 'http://localhost:8000/api/',
  timeout: 10000,
  auth: {username: 'admin',
         password: 'skagnfka'}
});


export class FaceLabeler extends Component {
  constructor() {
    super()
  }
  
  componentDidMount() {
    var _this = this;
    this.serverRequest = Server.get("persons/?page_size=1000")
    console.log(this.serverRequest)
  }


  render() {
    return (
      <Card>
        <Card.Content>
          <Image 
            height={260}
            width={260}
            shape='rounded'
            src={''} />
          <Card.Header>
            <Divider/>
            {"Who is this person?"}
          </Card.Header>
        </Card.Content>
        <Card.Content extra>
          <Dropdown  
            placeholder='Choose Person' 
            search 
            fluid
            selection 
            allowAdditions
            options={[]} />
          <Divider/>
          <div className='ui two buttons'>
            <Popup
              trigger={<Button 
                basic
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
    )
}
}