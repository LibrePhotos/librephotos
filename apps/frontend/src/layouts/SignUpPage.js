import React, { Component } from "react";
import {
  Image,
  Header,
  Divider,
  Message,
  Segment,
  Button,
  Form
} from "semantic-ui-react";
import { connect } from "react-redux";
import {signup} from "../actions/authActions";


export class SignupPage extends Component {
  constructor(props) {
    super(props);
    this.onSubmit = this.onSubmit.bind(this);
    this.handleServerProtocolChange = this.handleServerProtocolChange.bind(
      this
    );
  }

  state = {
    username: "",
    password: "",
    firstname:"",
    lastname:"",
    passwordConfirm: "",
    serverAddress: "",
    email: "",
    serverProtocol: "https://"
  };

  handleChange = (e, { name, value }) => this.setState({ [name]: value });

  handleServerProtocolChange = (e, { name, value }) =>
    this.setState({ serverProtocol: value });

  onSubmit(event) {
    event.preventDefault();
    this.props.dispatch(
      signup(
        this.state.username.toLowerCase(),
        this.state.password,
        this.state.email
      )
    );
    // console.log(this.props);
    // console.log(this.state.password)
    // this.props.onSubmit(this.state.username.toLowerCase(), this.state.password);
  }

  render() {

    const {
      username,
      password,
      firstname,
      lastname,
      email,
      passwordConfirm,
      serverAddress
    } = this.state;

    return (
      <div
        style={{
          paddingTop: 150,
          position: "fixed",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          overflowY: "auto",
          // background:"url('/login_background.jpg')",
          backgroundColor: "#dddddd",
          backgroundSize: "cover"
        }}
      >
        <div style={{ maxWidth: 500, padding: 20, margin: "0 auto" }}>
          <Header as="h3" textAlign="center">
            <Image src={"/logo.png"} />
            <Header.Content>LibrePhotos</Header.Content>
          </Header>
          <Segment attached>
            <Header>Signup</Header>
            <Form>
              <Form.Field>
                <label>User Name</label>
                <Form.Input
                  icon="user"
                  placeholder="Username"
                  name="username"
                  value={username}
                  onChange={this.handleChange}
                />
              </Form.Field>
              <Form.Field>
                <label>Email</label>
                <Form.Input
                  icon="mail"
                  placeholder="Email"
                  name="email"
                  value={email}
                  onChange={this.handleChange}
                />
              </Form.Field>
              <Form.Field>
                <label>First name</label>
                <Form.Input
                  placeholder="First name"
                  name="firstname"
                  value={firstname}
                  onChange={this.handleChange}
                />
              </Form.Field>
              <Form.Field>
                <label>Last name</label>
                <Form.Input
                  placeholder="Last name"
                  name="lastname"
                  value={lastname}
                  onChange={this.handleChange}
                />
              </Form.Field>
              <Form.Field>
                <label>Password</label>
                <Form.Input
                  error={
                    this.state.passwordConfirm.length > 0 &&
                    this.state.password !== this.state.passwordConfirm
                  }
                  icon="lock"
                  type="password"
                  placeholder="Password"
                  name="password"
                  value={password}
                  onChange={this.handleChange}
                />
                <label>Confirm Password</label>
                <Form.Input
                  error={
                    this.state.passwordConfirm.length > 0 &&
                    this.state.password !== this.state.passwordConfirm
                  }
                  icon="lock"
                  type="password"
                  placeholder="Confirm password"
                  name="passwordConfirm"
                  value={passwordConfirm}
                  onChange={this.handleChange}
                />
                <Divider />
              </Form.Field>
              <Button
                onClick={() => {
                  this.props.dispatch(
                    signup(
                      this.state.username.toLowerCase(),
                      this.state.password,
                      this.state.email,
                      this.state.firstname,
                      this.state.lastname
                    )
                  );
                }}
                disabled={
                  this.state.password.length === 0 ||
                  this.state.password !== this.state.passwordConfirm
                }
                fluid
                color="blue"
              >
                Sign Up
              </Button>
            </Form>
          </Segment>
          {this.props.errors &&
            this.props.errors.non_field_errors && (
              <Message color="red" secondary attached>
                {this.props.errors.non_field_errors}
              </Message>
            )}
          {this.props.errors &&
            this.props.errors.password && (
              <Message color="red" secondary attached>
                Password may not be blank!
              </Message>
            )}
          {this.props.errors &&
            this.props.errors.username && (
              <Message color="red" secondary attached="bottom">
                Username may not be blank!
              </Message>
            )}
        </div>
        <div
          style={{
            maxWidth: 400,
            textAlign: "center",
            paddingTop: "10%",
            margin: "0 auto"
          }}
        />
      </div>
    );
  }
}

SignupPage = connect(store => {
  return {
    auth: store.auth
  };
})(SignupPage);
