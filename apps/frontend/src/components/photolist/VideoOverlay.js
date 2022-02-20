import React, { Component } from "react";
import { Icon } from "semantic-ui-react";

export default class VideoOverlay extends Component {
  render() {
    return (
      <span>
        {this.props.item.type == "video" && <Icon name="play" inverted />}
      </span>
    );
  }
}
