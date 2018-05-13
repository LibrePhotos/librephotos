import React, {Component} from 'react';
import { Card, Image, Input, Header, Divider, Message, Item, Loader, Dimmer,Rating, Dropdown,
         Container, Label, Popup, Segment, Button, Icon, Form} from 'semantic-ui-react';
import { connect } from "react-redux";

import {login} from '../actions/authActions'
import * as reducers from '../reducers'

import { push } from 'react-router-redux'


const options = [
  { key: 'https://', text: 'https://', value: 'https://' },
  { key: 'http://', text: 'http://', value: 'http://' },
]


export class LoginPage extends Component {
  constructor(props) {
    super(props)
    this.onSubmit = this.onSubmit.bind(this)
    this.handleServerProtocolChange = this.handleServerProtocolChange.bind(this)
  }

  state = { 
    username: '', 
    password: '', 
    serverAddress: '',
    serverProtocol: 'https://'}


  handleChange = (e, { name, value }) => this.setState({ [name]: value })

  handleServerProtocolChange = (e, {name, value}) => this.setState({serverProtocol:value})

  onSubmit(event) {
    event.preventDefault()
    console.log(this.props)
    this.props.onSubmit(this.state.username,this.state.password)
  }

  render() {
    console.log(this.state)
    console.log(this.props)

    const { username, password, serverAddress } = this.state

    return (
      <div style={{
          paddingTop:150,
          position:'fixed',
          left:0,
          top:0,
          width:'100%',
          height:'100%',
          overflowY:'auto',
          // background:"url('/login_background.jpg')",
          backgroundColor:'#dddddd',
          backgroundSize:'cover'}}>

          <div style={{maxWidth:500,padding:20,margin:'0 auto'}}>



            <Header as='h3' textAlign='center'>
            <Image src={'/logo.png'}/>
            <Header.Content>
            Ownphotos
            </Header.Content>

            </Header>
            <Segment attached>
            <Form onSubmit={this.onSubmit}>

              <Form.Field>
                <label>User Name</label>
                <Form.Input 
                  icon='user'
                  placeholder='Username' 
                  name='username' 
                  value={username} 
                  onChange={this.handleChange} />
              </Form.Field>
              <Form.Field>              
                <label>Password</label>
                <Form.Input 
                  icon='lock'
                  type='password' placeholder='Password' 
                  name='password' 
                  value={password} 
                  onChange={this.handleChange} />
                <Divider/>
                <Form.Button fluid color='blue' content='Log in' />
              </Form.Field>
            </Form>
            </Segment>
            { this.props.errors && this.props.errors.non_field_errors && (
              <Message  color='red' secondary attached>
              {this.props.errors.non_field_errors}
              </Message>
            )}
            { this.props.errors && this.props.errors.password && (
              <Message  color='red' secondary attached>
              Password may not be blank!
              </Message>
            )}
            { this.props.errors && this.props.errors.username && (
              <Message  color='red' secondary attached='bottom'>
              Username may not be blank!
              </Message>
            )}
          </div>
          <div style={{maxWidth:400,textAlign:'center',paddingTop:'10%',margin:'0 auto'}}>
          A comfy place for your photos.
          </div>
      </div>
     )
  }
}

              // <Form.Field>
              //   <label>Server Address</label>
              //   <Input 
              //     icon='server'
              //     label={
              //     <Dropdown 
              //       onChange={this.handleServerProtocolChange}
              //       defaultValue='https://' 
              //       options={options} />
              //     }
              //     placeholder='ownphotos.example.com' 
              //     name='serverAddress' 
              //     value={serverAddress} 
              //     onChange={this.handleChange} />
              // </Form.Field>
