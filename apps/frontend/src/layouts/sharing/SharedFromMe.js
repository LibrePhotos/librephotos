import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { Header, Icon, Loader, Menu } from "semantic-ui-react";

import { fetchUserAlbumsSharedFromMe } from "../../actions/albumsActions";
import { fetchPhotosSharedFromMe } from "../../actions/photosActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import { PhotosetType } from "../../reducers/photosReducer";
import { AlbumsShared } from "./AlbumsShared";
import { PhotosShared } from "./PhotosShared";

export class SharedFromMe extends Component {
  componentDidMount() {
    if (this.props.fetchedPhotosetType !== PhotosetType.SHARED_BY_ME) {
      this.props.dispatch(fetchPublicUserList());
      this.props.dispatch(fetchPhotosSharedFromMe());
      this.props.dispatch(fetchUserAlbumsSharedFromMe());
    }
  }

  getSubHeader(activeItem) {
    if (activeItem === "photos") {
      return (
        <Header.Subheader>
          {this.props.photosFlat.length} photo share(s) with {this.props.photosGroupedByUser.length} user(s)
        </Header.Subheader>
      );
    }
    return <Header.Subheader>You shared {this.props.albums.albumsSharedFromMe.length} albums</Header.Subheader>;
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
            {activeItem === "photos" ? "Photos" : "Albums"} you shared {this.getSubHeader(activeItem)}
          </Header.Content>
        </Header>
      </div>
    );
  }

  getMenu(activeItem) {
    return (
      <div style={{ marginLeft: -5, height: 40 }}>
        <Menu pointing secondary>
          <Menu.Item as={Link} to="/shared/fromme/photos/" name="photos" active={activeItem === "photos"}>
            {"Photos "} <Loader size="mini" inline />
          </Menu.Item>
          <Menu.Item as={Link} to="/shared/fromme/albums/" name="albums" active={activeItem === "albums"}>
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
        {activeItem === "photos" && <PhotosShared isSharedToMe={false} />}
        {activeItem === "albums" && <AlbumsShared isSharedToMe={false} />}
      </div>
    );
  }
}

SharedFromMe = connect(store => ({
  photosFlat: store.photos.photosFlat,
  photosGroupedByUser: store.photos.photosGroupedByUser,
  fetchedPhotosetType: store.photos.fetchedPhotosetType,
  albums: store.albums,
  pub: store.pub,
}))(SharedFromMe);
