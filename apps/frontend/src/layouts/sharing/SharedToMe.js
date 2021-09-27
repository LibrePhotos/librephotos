import React, { Component } from "react";
import { connect } from "react-redux";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { fetchPhotosSharedToMe } from "../../actions/photosActions";
import { Photoset } from "../../reducers/photosReducer";
import { Header, Icon, Loader, Menu } from "semantic-ui-react";
import { Link } from "react-router-dom";
import { fetchPublicUserList } from "../../actions/publicActions";

var DAY_HEADER_HEIGHT = 70;

export class SharedToMe extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotoset !== Photoset.SHARED_TO_ME) {
      this.props.dispatch(fetchPublicUserList());
      this.props.dispatch(fetchPhotosSharedToMe());
    }
  }

  getSubHeader(activeItem) {
    if (activeItem === "photos") {
      return (
        <Header.Subheader>
          {this.props.photosGroupedByUser.length} user(s) shared{" "}
          {this.props.photosFlat.length} photo(s) with you
        </Header.Subheader>
      );
    } else {
      return (
        <Header.Subheader>
          {this.props.photosGroupedByUser.length} user(s) shared{" "}
          {this.props.photosFlat.length > 0 &&
            this.props.albums.albumsSharedToMe
              .map((el) => el.albums.length)
              .reduce((a, b) => a + b)}{" "}
          album(s) with you
        </Header.Subheader>
      );
    }
  }

  getHeader(activeItem) {
    return (
      <div style={{ height: 60, paddingTop: 10 }}>
        <Header as="h2">
          <Icon.Group size="big">
            <Icon
              name={
                activeItem === "photos" ? "image outline" : "images outline"
              }
            />
            <Icon corner name="share" color="green" size="mimi" />
          </Icon.Group>
          <Header.Content style={{ paddingLeft: 10 }}>
            {activeItem === "photos" ? "Photos" : "Albums"} others shared{" "}
            {this.getSubHeader(activeItem)}
          </Header.Content>
        </Header>
      </div>
    );
  }

  getMenu(activeItem) {
    return (
      <div style={{ marginLeft: -5, height: 40 }}>
        <Menu pointing secondary>
          <Menu.Item
            as={Link}
            to="/shared/tome/photos/"
            name="photos"
            active={activeItem === "photos"}
          >
            {"Photos "} <Loader size="mini" inline />
          </Menu.Item>
          <Menu.Item
            as={Link}
            to="/shared/tome/albums/"
            name="albums"
            active={activeItem === "albums"}
          >
            {"Albums "} <Loader size="mini" inline />
          </Menu.Item>
        </Menu>
      </div>
    );
  }

  getGroupHeader(group) {
    const owner = this.props.pub.publicUserList.filter(
      (e) => e.id === group.user_id
    )[0];
    var displayName = group.user_id;
    if (owner && owner.last_name.length + owner.first_name.length > 0) {
      displayName = owner.first_name + " " + owner.last_name;
    } else if (owner) {
      displayName = owner.username;
    }
    return (
      <div
        style={{
          paddingTop: 15,
          paddingBottom: 15,
        }}
      >
        <Header as="h3">
          <Icon name="user circle outline" />
          <Header.Content>
            {displayName}
            <Header.Subheader>
              <Icon name="photo" />
              shared {group.photos.length} photos with you
            </Header.Subheader>
          </Header.Content>
        </Header>
      </div>
    );
  }

  render() {
    const activeItem = this.props.match.params.which;

    return (
      <div>
        {this.getHeader(activeItem)}
        {this.getMenu(activeItem)}
        {this.props.photosGroupedByUser.map((group) => {
          return (
            <PhotoListView
              title={"Photos"}
              additionalSubHeader={" shared by user with id " + group.user_id}
              loading={this.props.fetchedPhotoset !== Photoset.SHARED_TO_ME}
              titleIconName={"images"}
              isDateView={false}
              photosGroupedByDate={group.photos}
              idx2hash={group.photos}
              isPublic={true}
              getHeader={(photoList) => this.getGroupHeader(group)}
            />
          );
        })}
      </div>
    );
  }
}

SharedToMe = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    photosGroupedByUser: store.photos.photosGroupedByUser,
    fetchedPhotoset: store.photos.fetchedPhotoset,
    pub: store.pub,
  };
})(SharedToMe);
