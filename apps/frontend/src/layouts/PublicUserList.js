import React, { Component } from "react";
import { Header, Image, Item } from "semantic-ui-react";
import {
  fetchUserPublicPhotos,
  fetchPublicUserList
} from "../actions/publicActions";
import { connect } from "react-redux";
import { PhotoListView } from "./ReusablePhotoListView";
import _ from "lodash";
import moment from "moment";
import {
  TopMenu,
  SideMenuNarrow,
  TopMenuPublic,
  SideMenuNarrowPublic
} from "./menubars";
import { Link } from "react-router-dom";

var TOP_MENU_HEIGHT = 45; // don't change this
var LEFT_MENU_WIDTH = 85; // don't change this

export class PublicUserList extends Component {
  componentDidMount() {
    this.props.dispatch(fetchPublicUserList());
  }
  render() {
    if (this.props.auth.access) {
      var menu = (
        <div>
          {this.props.ui.showSidebar && <SideMenuNarrow />}
          <TopMenu />
        </div>
      );
    } else {
      var menu = (
        <div>
          {this.props.ui.showSidebar && <SideMenuNarrowPublic />}
          <TopMenuPublic />
        </div>
      );
    }
    return (
      <div>
        {menu}
        <div
          style={{
            paddingTop: TOP_MENU_HEIGHT + 5,
            paddingLeft: this.props.ui.showSidebar ? LEFT_MENU_WIDTH + 5 : 5
          }}
        >
          <Header>
            Users
            <Header.Subheader>
              {this.props.pub.publicUserList.length} Users on this server
            </Header.Subheader>
          </Header>

          <Item.Group unstackable>
            {this.props.pub.publicUserList.map((el, idx) => {
              return (
                <Item as={Link} to={`/user/${el.username}/`}>
                  <Item.Image avatar size="tiny" src="/unknown_user.jpg" />

                  <Item.Content>
                    <Item.Header>{el.username}</Item.Header>
                    <Item.Description>
                      {el.public_photo_count} public photos
                    </Item.Description>
                    <Item.Extra>Joined {moment(el.date_joined).format("MMM YYYY")}</Item.Extra>
                  </Item.Content>
                </Item>
              );
            })}
          </Item.Group>
        </div>
      </div>
    );
  }
}

PublicUserList = connect(store => {
  return {
    pub: store.pub,
    ui: store.ui,
    auth: store.auth
  };
})(PublicUserList);
