import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import {
  Divider,
  Icon,
  Menu,
  Sidebar,
} from "semantic-ui-react";

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
           <Menu.Item  as={Link} to="/" >
            <Icon name="image outline" />
            <small>Photos</small>
          </Menu.Item>
          <Menu.Item as={Link} to="/useralbums">
                  <Icon name="images outline" />
            <small>Albums</small>
          </Menu.Item>
          <Menu.Item as={Link} to="/favorites">
                  <Icon name="star outline" />
            <small>Favorites</small>
          </Menu.Item>
          <Menu.Item as={Link} to="/useralbums">
                  <Icon name="search plus icon"/>
            <small>Discover</small>
          </Menu.Item>
          <Menu.Item as={Link} to="/hidden">
                  <Icon name="archive icon"/>
            <small>Archive</small>
          </Menu.Item>
          <Menu.Item as={Link} to="/statistics">
                  <Icon name="bar chart"/>
            <small>Data Viz</small>
          </Menu.Item>
          <Menu.Item as={Link} to="/faces">
                  <Icon name="user circle outline"/>
            <small>Faces </small>
          </Menu.Item>
          <Menu.Item as={Link} to="/users">
                  <Icon name="share alternate icon"/>
            <small>Sharing</small>
          </Menu.Item>
          <Menu.Item as={Link} to="/settings">
                  <Icon name="settings"/>
            <small>Settings</small>
          </Menu.Item>
          <Menu.Item as={Link} to="/admin">
                  <Icon name="wrench"/>
            <small>Admin <br/> Area</small>
          </Menu.Item>
        </Menu>
      );
    }
  }

  SideMenuNarrow = connect((store) => {
    return {
      auth: store.auth,
      jwtToken: store.auth.jwtToken,
      location: store.routerReducer.location,
    };
  })(SideMenuNarrow);