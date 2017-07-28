import React, {Component} from 'react';
import { Card, Image, Inpu, Header, Divider, Item, Loader, Dimmer,Rating,
         Container, Label, Popup, Segment, Button, Icon, Form} from 'semantic-ui-react';
import { connect } from "react-redux";

import {login} from '../actions/authActions'

export class LoginPage extends Component {
  constructor(props) {
    super(props)
    this.handleSubmit = this.handleSubmit.bind(this)
  }

  state = { username: '', password: '', submittedName: '', submittedEmail: '' }

  handleChange = (e, { name, value }) => this.setState({ [name]: value })

  handleSubmit(event) {
    this.props.dispatch(login(this.state.username,this.state.password))
  }

  render() {
    const { username, password } = this.state
    return (
      <div style={{overflow:'hidden'}}>
        <div style={{
          textAlign:'center',
          height:'100%',
          marginTop:'5%', overflow:'hidden'}}>
          <div style={{
            display:'inline-block',
            padding:'20px', overflow:'hidden'}}>
            <Header textAlign='center'>
              <Header.Content>
                <Image size='small' src={'/logo.png'}/>
                <Header as='h1'>Ownphotos</Header>
                <Header as='h3'>Login</Header>
              </Header.Content>
            </Header>
            <Form onSubmit={this.handleSubmit}>
                <Form.Input placeholder='Username' name='username' value={username} onChange={this.handleChange} />
                <Form.Input type='password' placeholder='Password' name='password' value={password} onChange={this.handleChange} />
                <Form.Button fluid color='green' content='Log in' />
            </Form>
          </div>
        </div>    
      </div>
     )
  }
}


LoginPage = connect((store)=>{
  return {
    jwtToken: store.auth.jwtToken
  }
})(LoginPage)
