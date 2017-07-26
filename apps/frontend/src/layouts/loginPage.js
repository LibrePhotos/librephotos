import React, {Component} from 'react';
import { Card, Image, Inpu, Header, Divider, Item, Loader, Dimmer,Rating,
         Container, Label, Popup, Segment, Button, Icon, Form} from 'semantic-ui-react';
import { connect } from "react-redux";


export class LoginPage extends Component {
	constructor(props) {
		super(props)
		this.handleSubmit = this.handleSubmit.bind(this)
	}

  state = { username: '', password: '', submittedName: '', submittedEmail: '' }

  handleChange = (e, { name, value }) => this.setState({ [name]: value })

	handleSubmit(event) {
		console.log(event)
	}

	render() {
		const { username, password } = this.state
		return (
			<div style={{overflow:'hidden'}}>
	      <div style={{
	      	textAlign:'center',
	      	height:'100%',
	      	marginTop:'20%', overflow:'hidden'}}>
	      	<div style={{
	      		display:'inline-block',
	      		padding:'20px', overflow:'hidden'}}>
		      	<Header textAlign='center'>
		      		<Header.Content>
				      	<Image size='small' src={'/logo.png'}/>
				      	Ownphotos<br/><br/>Login
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