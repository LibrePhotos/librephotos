import React, { Component } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  Divider,
  Form,
  Header,
  Image,
  Message,
  Segment,
} from "semantic-ui-react";
import { withTranslation } from "react-i18next";
export class LoginPage extends Component {
  constructor(props) {
    super(props);
    this.onSubmit = this.onSubmit.bind(this);
    this.handleServerProtocolChange =
      this.handleServerProtocolChange.bind(this);
  }

  state = {
    username: "",
    password: "",
    serverAddress: "",
    serverProtocol: "https://",
  };
  componentDidMount() {
    this.props.fetchSiteSettings();
  }

  handleChange = (e, { name, value }) => this.setState({ [name]: value });

  handleServerProtocolChange = (e, { name, value }) =>
    this.setState({ serverProtocol: value });

  onSubmit(event) {
    event.preventDefault();
    this.props.onSubmit(this.state.username.toLowerCase(), this.state.password);
  }

  render() {
    const { username, password } = this.state;

    const timeNow = new Date().toLocaleTimeString();

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
          backgroundColor: "#dddddd",
          backgroundSize: "cover",
        }}
      >
        <div style={{ maxWidth: 500, padding: 20, margin: "0 auto" }}>
          <div
            style={{
              maxWidth: 400,
              textAlign: "center",
              margin: "0 auto",
              padding: 20,
            }}
          >
            <Image src={"/logo.png"} size="tiny" verticalAlign="middle" />{" "}
            <span style={{ paddingLeft: 5, fontSize: 18 }}>
              <b>{this.props.t("login.name")}</b>
            </span>
          </div>

          <Segment attached>
            <Header>{this.props.t("login.login")}</Header>

            <Form onSubmit={this.onSubmit}>
              <Form.Field>
                <label>{this.props.t("login.username")}</label>
                <Form.Input
                  icon="user"
                  placeholder={this.props.t("login.usernameplaceholder")}
                  name="username"
                  value={username}
                  onChange={this.handleChange}
                />
              </Form.Field>
              <Form.Field>
                <label>{this.props.t("login.password")}</label>
                <Form.Input
                  icon="lock"
                  type="password"
                  placeholder={this.props.t("login.passwordplaceholder")}
                  name="password"
                  value={password}
                  onChange={this.handleChange}
                />
                <Divider />
                <Form.Button fluid color="blue" content="Log in" />

                {this.props.siteSettings.allow_registration && (
                  <div>
                    <Divider />
                    <Button
                      disabled={!this.props.siteSettings.allow_registration}
                      as={Link}
                      to="/signup"
                      fluid
                      color="green"
                      content={this.props.t("login.signup")}
                    />
                  </div>
                )}
              </Form.Field>
            </Form>
          </Segment>
          {this.props.errors &&
            this.props.errors.data &&
            this.props.errors.data.detail && (
              <Message color="red" secondary attached>
                <p>{this.props.errors.data.detail}</p>
                <p>{timeNow}</p>
              </Message>
            )}
          {this.props.errors &&
            this.props.errors.data &&
            !this.props.errors.data.detail && (
              <Message color="red" secondary attached>
                <p>{this.props.t("login.errorbackend")}</p>
                <p>{timeNow}</p>
              </Message>
            )}
          {this.props.errors && this.props.errors.password && (
            <Message color="red" secondary attached>
              <p>{this.props.t("login.errorpassword")}</p>
              <p>{timeNow}</p>
            </Message>
          )}
          {this.props.errors && this.props.errors.username && (
            <Message color="red" secondary attached="bottom">
              <p>{this.props.t("login.errorusername")}</p>
              <p>{timeNow}</p>
            </Message>
          )}
        </div>
        <div
          style={{
            maxWidth: 400,
            textAlign: "center",
            paddingTop: "10%",
            margin: "0 auto",
          }}
        >
          {this.props.t("login.tagline")}
        </div>
      </div>
    );
  }
}

LoginPage = withTranslation()(LoginPage);
