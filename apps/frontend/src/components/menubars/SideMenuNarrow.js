import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { Divider, Icon, Menu, Dropdown } from "semantic-ui-react";

import { toggleSidebar } from "../../actions/uiActions";
import { logout } from "../../actions/authActions";

export class SideMenuNarrow extends Component {
  state = { activeItem: "all photos" };

  handleItemClick = (e, { name }) => this.setState({ activeItem: name });
  handleLogout = (e, { name }) => this.props.dispatch(logout());

  render() {
    return (
      <Menu
        borderless
        icon="labeled"
        vertical
        fixed="left"
        floated
        pointing
        width="thin"
      >
        <Divider hidden />
        <Divider hidden />
        <Divider hidden />
        <Divider hidden />

        {false && (
          <Menu.Item name="logo">
            <img height={40} alt="Logo of LibrePhotos" src="/logo.png" />
            <p>
              <small>LibrePhotos</small>
            </p>
          </Menu.Item>
        )}

        <Dropdown
          pointing="left"
          item
          icon={<Icon size="big" name="image outline" />}
        >
          <Dropdown.Menu>
            <Dropdown.Header>Photos</Dropdown.Header>
            <Dropdown.Item as={Link} to="/">
              <Icon color="green" name="calendar check outline" />
              {"  With Timestamp"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/notimestamp">
              <Icon color="red" name="calendar times outline" />
              {"  Without Timestamp"}
            </Dropdown.Item>
            <Dropdown.Divider />

            <Dropdown.Item as={Link} to="/recent">
              <Icon name="clock" />
              {"  Recently Added"}
            </Dropdown.Item>
            <Dropdown.Divider />

            <Dropdown.Item as={Link} to="/hidden">
              <Icon color="red" name="hide" />
              {"  Hidden"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/favorites">
              <Icon name="star" color="yellow" />
              {"  Favorites"}
            </Dropdown.Item>
            <Dropdown.Item
              disabled={!this.props.auth.access}
              as={Link}
              to={
                this.props.auth.access
                  ? `/user/${this.props.auth.access.name}`
                  : "/"
              }
            >
              <Icon color="green" name="globe" />
              {"  My Public Photos"}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Photos</small>
        </div>

        <Divider hidden />

        <Dropdown
          pointing="left"
          item
          icon={
            <div>
              <Icon.Group size="big">
                <Icon name="images outline" />
                <Icon name="bookmark" corner />
              </Icon.Group>
            </div>
          }
        >
          <Dropdown.Menu>
            <Dropdown.Header>Albums</Dropdown.Header>
            <Dropdown.Item as={Link} to="/people">
              <Icon name="users" />
              {"  People"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/places">
              <Icon name="map" />
              {"  Places"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/things">
              <Icon name="tags" />
              {"  Things"}
            </Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item as={Link} to="/useralbums">
              <Icon name="bookmark" />
              {"  My Albums"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/events">
              <Icon name="wizard" />
              {"  Auto Created Albums"}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Albums</small>
        </div>

        <Divider hidden />
        <Dropdown
          pointing="left"
          item
          icon={<Icon size="big" name="bar chart" />}
        >
          <Dropdown.Menu>
            <Dropdown.Header>Data Visualization</Dropdown.Header>
            <Dropdown.Item as={Link} to="/placetree">
              <Icon name="sitemap" />
              {"  Place Tree"}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/wordclouds">
              <Icon name="cloud" />
              {"  Word Clouds"}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/timeline">
              <Icon name="bar chart" />
              {"  Timeline"}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/socialgraph">
              <Icon name="share alternate" />
              {"  Social Graph"}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/facescatter">
              <Icon name="user circle" />
              {"  Face Clusters"}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Data Viz</small>
        </div>

        <Divider hidden />
        <Dropdown
          pointing="left"
          item
          icon={<Icon size="big" name="dashboard" />}
        >
          <Dropdown.Menu>
            <Dropdown.Header>Dashboards</Dropdown.Header>
            <Dropdown.Item as={Link} to="/faces">
              <Icon name="user circle outline" />
              {"  Face Recognition"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/settings">
              <Icon name="database" />
              {"  Library"}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Dashboards</small>
        </div>

        {this.props.auth && (
          <div>
            <Divider hidden />
            <Dropdown
              pointing="left"
              item
              icon={<Icon size="big" name="users" />}
            >
              <Dropdown.Menu>
                <Dropdown.Header>Sharing</Dropdown.Header>

                <Dropdown.Item
                  disabled={!this.props.auth.access}
                  as={Link}
                  to={`/users/`}
                >
                  <Icon name="globe" />
                  {"  Public photos"}
                </Dropdown.Item>

                <Dropdown.Item as={Link} to="/shared/fromme/photos/">
                  <Icon name="share" color="red" />
                  {"  You shared"}
                </Dropdown.Item>

                <Dropdown.Item as={Link} to="/shared/tome/photos/">
                  <Icon name="share" color="green" />
                  {"  Shared with you"}
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
            <div style={{ marginTop: -17 }}>
              <small>Sharing</small>
            </div>
          </div>
        )}
      </Menu>
    );
  }
}

SideMenuNarrow = connect((store) => {
  return {
    auth: store.auth,
    jwtToken: store.auth.jwtToken,
    location: store.router.location,
  };
})(SideMenuNarrow);
