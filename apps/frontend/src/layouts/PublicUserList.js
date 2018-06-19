import React, { Component } from "react";
import { Header, Image, Item, Icon, Grid, Divider } from "semantic-ui-react";
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
import { serverAddress } from "../api_client/apiClient";

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
            paddingTop: TOP_MENU_HEIGHT,
            paddingLeft: this.props.ui.showSidebar ? LEFT_MENU_WIDTH + 5 : 5
          }}
        >
          <div style={{ height: 60, paddingTop: 10 }}>
            <Header as="h2">
              <Icon name="users circle" />
              <Header.Content>
                Users{" "}
                <Header.Subheader>
                  Showing {this.props.pub.publicUserList.length} users
                </Header.Subheader>
              </Header.Content>
            </Header>
          </div>
          <div style={{ padding: 10 }}>
            <Item.Group unstackable>
              {this.props.pub.publicUserList.map((el, idx) => {
                if (el.first_name.length > 0 && el.last_name.length > 0) {
                  var displayName = el.first_name + " " + el.last_name;
                } else {
                  var displayName = el.username;
                }

                return (
                  <Item>
                    <Item.Image avatar size="tiny" src="/unknown_user.jpg" />
                    <Item.Content>
                      <Item.Header as={Link} to={`/user/${el.username}/`}>
                        {displayName}
                      </Item.Header>
                      <Item.Meta>
                        {el.public_photo_count} public photos
                      </Item.Meta>
                      <Item.Extra>
                        Joined {moment(el.date_joined).format("MMM YYYY")}
                      </Item.Extra>
                      <Item.Description>
                        <Grid doubling stackable>
                          <Grid.Row
                            columns={this.props.ui.gridType === "dense" ? 5 : 3}
                          >
                            {el.public_photo_samples
                              .slice(
                                0,
                                this.props.ui.gridType === "dense" ? 10 : 6
                              )
                              .map(photo => (
                                <Grid.Column>
                                  <Image
                                    src={
                                      serverAddress +
                                      "/media/square_thumbnails/" +
                                      photo.image_hash +
                                      ".jpg"
                                    }
                                  />
                                  <Divider hidden />
                                </Grid.Column>
                              ))}
                          </Grid.Row>
                        </Grid>
                      </Item.Description>
                    </Item.Content>
                  </Item>
                );
              })}
            </Item.Group>
          </div>
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
