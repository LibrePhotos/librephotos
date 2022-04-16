import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { Header, Icon, Loader, Menu } from "semantic-ui-react";

import { fetchUserAlbumsSharedToMe } from "../../actions/albumsActions";
import { fetchPhotosSharedToMe } from "../../actions/photosActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import { PhotosetType } from "../../reducers/photosReducer";
import { AlbumsShared } from "./AlbumsShared";
import { PhotosShared } from "./PhotosShared";

export class SharedToMe extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotosetType !== PhotosetType.SHARED_TO_ME) {
      this.props.dispatch(fetchPublicUserList());
      this.props.dispatch(fetchPhotosSharedToMe());
      this.props.dispatch(fetchUserAlbumsSharedToMe());
    }
  }

  getSubHeader(activeItem) {
    if (activeItem === "photos") {
      return (
        <Header.Subheader>
          {this.props.photosGroupedByUser.length} user(s) shared {this.props.photosFlat.length} photo(s) with you
        </Header.Subheader>
      );
    }
    return (
      <Header.Subheader>
        {this.props.albums.albumsSharedToMe.length} user(s) shared{" "}
        {this.props.albums.albumsSharedToMe.length > 0 &&
          this.props.albums.albumsSharedToMe.map(el => el.albums.length).reduce((a, b) => a + b, 0)}{" "}
        album(s) with you
      </Header.Subheader>
    );
  }

  getHeader(activeItem) {
    return (
      <div style={{ height: 60, paddingTop: 10 }}>
        <Header as="h2">
          <Icon.Group size="big">
            <Icon name={activeItem === "photos" ? "image outline" : "images outline"} />
            <Icon corner name="share" color="green" size="mimi" />
          </Icon.Group>
          <Header.Content style={{ paddingLeft: 10 }}>
            {activeItem === "photos" ? "Photos" : "Albums"} others shared {this.getSubHeader(activeItem)}
          </Header.Content>
        </Header>
      </div>
    );
  }

  getMenu(activeItem) {
    return (
      <div style={{ marginLeft: -5, height: 40 }}>
        <Menu pointing secondary>
          <Menu.Item as={Link} to="/shared/tome/photos/" name="photos" active={activeItem === "photos"}>
            {"Photos "} <Loader size="mini" inline />
          </Menu.Item>
          <Menu.Item as={Link} to="/shared/tome/albums/" name="albums" active={activeItem === "albums"}>
            {"Albums "} <Loader size="mini" inline />
          </Menu.Item>
        </Menu>
      </div>
    );
  }

  render() {
    const activeItem = this.props.match.params.which;

    return (
      <div>
        {this.getHeader(activeItem)}
        {this.getMenu(activeItem)}
        {activeItem === "photos" && <PhotosShared isSharedToMe />}
        {activeItem === "albums" && <AlbumsShared isSharedToMe />}
      </div>
    );
  }
}

SharedToMe = connect(store => ({
  photosFlat: store.photos.photosFlat,
  photosGroupedByUser: store.photos.photosGroupedByUser,
  fetchedPhotosetType: store.photos.fetchedPhotosetType,
  albums: store.albums,
  pub: store.pub,
}))(SharedToMe);
