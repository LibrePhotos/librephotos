import React, { Component } from "react";
import { Image } from "semantic-ui-react";

import { serverAddress } from "../api_client/apiClient";

export class Tile extends Component {
  render() {
    return this.props.video === true ? (
      <Image style={{ height: this.props.height, width: this.props.width }} key={this.props.image_hash}>
        <video
          width={this.props.width}
          height={this.props.height}
          style={{ objectFit: "cover" }}
          src={`${serverAddress}/media/square_thumbnails/${this.props.image_hash}`}
          autoPlay
          muted
          loop
          playsInline
        />
      </Image>
    ) : (
      <Image
        style={{ display: "inline-block", objectFit: "cover" }}
        width={this.props.width}
        height={this.props.height}
        src={`${serverAddress}/media/square_thumbnails/${this.props.image_hash}`}
      />
    );
  }
}
