import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { Button, Icon, Image, Menu } from "semantic-ui-react";
import { toggleSidebar } from "../../actions/uiActions";

export class TopMenuPublic extends Component {
  render() {
    return (
      <div>
        <Menu
          style={{ contentAlign: "left", backgroundColor: "#eeeeee" }}
          borderless
          fixed="top"
          size="mini"
        >
          <Menu.Menu position="left">
            <Menu.Item>
              <Icon
                size="big"
                onClick={() => {
                  this.props.dispatch(toggleSidebar());
                }}
                name={"sidebar"}
              />
              <Button
                color="black"
                style={{
                  padding: 2,
                }}
              >
                <Image height={30} src="/logo-white.png" />
              </Button>
            </Menu.Item>
          </Menu.Menu>

          <Menu.Item position="right">
            <Button as={Link} to="/login">
              Login
            </Button>
          </Menu.Item>
        </Menu>
      </div>
    );
  }
}

TopMenuPublic = connect((store) => {
  return {
    showSidebar: store.ui.showSidebar,
    gridType: store.ui.gridType,
  };
})(TopMenuPublic);
