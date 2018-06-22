import React, { Component } from "react";
import { Header, Image, Item, Icon, Grid, Divider } from "semantic-ui-react";
import { fetchPhotosSharedToMe } from "../actions/photosActions";
import { fetchPublicUserList } from "../actions/publicActions";
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
import { SecuredImageJWT } from "../components/SecuredImage";

var TOP_MENU_HEIGHT = 45; // don't change this
var LEFT_MENU_WIDTH = 85; // don't change this

export class PhotosSharedToMe extends Component {
  componentDidMount() {
    this.props.dispatch(fetchPublicUserList());
    this.props.dispatch(fetchPhotosSharedToMe());
  }

  render() {
    return (
      <div>
        <div style={{ height: 60, paddingTop: 10 }}>
          <Header as="h2">
            <Icon name="users circle" />
            <Header.Content>
              Photos others shared{" "}
              <Header.Subheader>
                {this.props.photos.photosSharedToMe.length} users shared{" "}
                {this.props.photos.photosSharedToMe.length > 0 &&
                  this.props.photos.photosSharedToMe
                    .map(el => el.photos.length)
                    .reduce((a, b) => a + b)}{" "}
                photos with you
              </Header.Subheader>
            </Header.Content>
          </Header>
        </div>
        <div style={{ paddingTop: 13, paddingLeft: 10, paddingRight: 10 }}>
          {this.props.photos.photosSharedToMe.map((el, idx) => {
            const owner = this.props.pub.publicUserList.filter(
              e => e.id === el.user_id
            )[0];
            if (owner && owner.last_name.length + owner.first_name.length > 0) {
              var displayName = owner.first_name + " " + owner.last_name;
            } else if (owner) {
              var displayName = owner.username;
            } else {
              var displayName = el.user_id;
            }

            return (
              <div style={{ padding: 10 }}>
                <Header>
                  <Image circular src="/unknown_user.jpg" />
                  <Header.Content>
                    {displayName}
                    <Header.Subheader>
                      shared {el.photos.length} photos
                    </Header.Subheader>
                  </Header.Content>
                </Header>
                {false && (
                  <div>
                    <Divider />
                    <Grid doubling stackable>
                      <Grid.Row
                        columns={this.props.ui.gridType === "dense" ? 5 : 3}
                      >
                        {el.photos
                          .slice(0, this.props.ui.gridType === "dense" ? 10 : 6)
                          .map(photo => (
                            <Grid.Column>
                              <SecuredImageJWT
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}

PhotosSharedToMe = connect(store => {
  return {
    pub: store.pub,
    ui: store.ui,
    auth: store.auth,
    photos: store.photos
  };
})(PhotosSharedToMe);
