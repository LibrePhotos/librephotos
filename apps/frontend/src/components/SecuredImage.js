import React, { Component } from "react";
import { connect } from "react-redux";
import {
  fetchPeopleAlbums,
  fetchAutoAlbums,
  generateAutoAlbums,
  fetchAutoAlbumsList
} from "../actions/albumsActions";
import { AlbumAutoCard, AlbumAutoGallery } from "../components/album";
import {
  Container,
  Image,
  Icon,
  Header,
  Button,
  Card,
  Label,
  Popup
} from "semantic-ui-react";

import { Server, serverAddress } from "../api_client/apiClient";


export class SecuredImageJWT extends Component {


  render() {
    const {
      height,
      width,
      style,
      src,
      onClick,
      size,
      rounded,
      avatar,
      as,
      to,
      label,
      circular,
    } = this.props;
    return (
      <Image
        {...this.props}
      />
    );
  }
}

export class SecuredImage extends Component {
  state = {
    imgData: null
  };

  componentWillMount() {
    console.log(this.props.src);
    Server.get(this.props.src)
      .then(resp => {
        console.log("success");
        this.setState({ imgData: resp.data.data });
      })
      .catch(err => {
        console.log("fail");
      });
  }
  render() {
    const { imgData } = this.state;
    var newProps = this.props;
    delete newProps.dispatch;
    if (imgData) {
      return <Image {...newProps} src={"data:image/jpeg;base64," + imgData} />;
    }
    return <Image {...newProps} src={"/thumbnail_placeholder.png"} />;
  }
}

SecuredImageJWT = connect(store => {
  return {
    auth: store.auth
  };
})(SecuredImageJWT);

