import _ from "lodash";
import React, { Component } from "react";
import { Link } from "react-router-dom";
import { Divider, Dropdown, Icon, Menu } from "semantic-ui-react";

import { LEFT_MENU_WIDTH } from "../../ui-constants";
export class SideMenuNarrowPublic extends Component {
  render() {
    return (
      <Menu
        style={{
          width: LEFT_MENU_WIDTH,
          overflowWrap: "break-word",
          wordWrap: "break-word",
          wordBreak: "break-word",
        }}
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
        <Dropdown pointing="left" item icon={<Icon size="big" name="globe" />}>
          <Dropdown.Menu>
            <Dropdown.Header>Public</Dropdown.Header>
            <Dropdown.Item as={Link} to="/users/">
              <Icon name="users" />
              {"  Users"}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Public</small>
        </div>
      </Menu>
    );
  }
}
