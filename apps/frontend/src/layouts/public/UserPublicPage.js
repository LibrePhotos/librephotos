import React, { Component } from "react";
import { fetchUserPublicPhotos } from "../../actions/publicActions";
import { connect } from "react-redux";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import _ from "lodash";
import moment from "moment";
import { TopMenu } from "../../components/menubars/TopMenu";
import { SideMenuNarrow } from "../../components/menubars/SideMenuNarrow";
import { TopMenuPublic } from "../../components/menubars/TopMenuPublic";
import { SideMenuNarrowPublic } from "../../components/menubars/SideMenuNarrowPublic";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../../ui-constants";

export class UserPublicPage extends Component {
  state = {
    photosGroupedByDate: [],
    idx2hash: [],
    username: null,
  };

  componentDidMount() {
    this.props.dispatch(
      fetchUserPublicPhotos(this.props.match.params.username)
    );
  }

  render() {
    var menu;
    if (this.props.auth.access) {
      menu = (
        <div>
          {this.props.ui.showSidebar && <SideMenuNarrow />}
          <TopMenu />
        </div>
      );
    } else {
      menu = (
        <div>
          {this.props.ui.showSidebar && <SideMenuNarrowPublic />}
          <TopMenuPublic />
        </div>
      );
    }
    const groupedPhotos =
      this.props.pub.userPublicPhotos[this.props.match.params.username];
    if (groupedPhotos) {
      groupedPhotos.forEach(
        (group) =>
          (group.date =
            moment(group.date).format("MMM Do YYYY, dddd") !== "Invalid date"
              ? moment(group.date).format("MMM Do YYYY, dddd")
              : group.date)
      );
    }
    return (
      <div>
        {menu}
        <div
          style={{
            paddingLeft: this.props.ui.showSidebar ? LEFT_MENU_WIDTH + 5 : 5,
            paddingRight: 0,
          }}
        >
          <div style={{ paddingTop: TOP_MENU_HEIGHT }}>
            <PhotoListView
              title={
                this.props.auth.access &&
                this.props.auth.access.name === this.props.match.params.username
                  ? "Your public photos"
                  : "Public photos of " + this.props.match.params.username
              }
              loading={this.props.pub.fetchingUserPublicPhotos}
              titleIconName={"globe"}
              photosGroupedByDate={groupedPhotos ? groupedPhotos : []}
              isDateView={true}
              idx2hash={
                groupedPhotos ? groupedPhotos.flatMap((el) => el.items) : []
              }
              isPublic={
                this.props.auth.access === undefined ||
                this.props.auth.access.name !== this.props.match.params.username
              }
            />
          </div>
        </div>
      </div>
    );
  }
}
UserPublicPage = connect((store) => {
  return {
    pub: store.pub,
    ui: store.ui,
    auth: store.auth,
  };
})(UserPublicPage);
