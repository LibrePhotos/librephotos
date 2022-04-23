import React, { Component } from "react";
import { connect } from "react-redux";
import { Image } from "semantic-ui-react";

import { Server } from "../api_client/apiClient";

export class SecuredImageJWT extends Component {
  render() {
    return <Image {...this.props} />;
  }
}

export class SecuredImage extends Component {
  state = {
    imgData: null,
  };

  componentDidMount() {
    Server.get(this.props.src)
      .then(resp => {
        this.setState({ imgData: resp.data.data });
      })
      .catch(err => {
        console.log("fail");
      });
  }

  render() {
    const { imgData } = this.state;
    const newProps = this.props;
    if (imgData) {
      return <Image {...newProps} src={`data:image/jpeg;base64,${imgData}`} />;
    }
    return <Image {...newProps} src="/thumbnail_placeholder.png" />;
  }
}

SecuredImageJWT = connect(store => ({
  auth: store.auth,
}))(SecuredImageJWT);
