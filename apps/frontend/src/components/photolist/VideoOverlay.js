import { Duration } from "luxon";
import React, { Component } from "react";
import { Button, Icon } from "semantic-ui-react";

export default class VideoOverlay extends Component {
  render() {
    return (
      <div>
        {this.props.item.type == "video" && (
          <div style={{ padding: 5, color: "white" }}>
            <Icon name="play" inverted />
            {this.props.item.video_length &&
              this.props.item.video_length !== "None" &&
              Duration.fromObject({
                seconds: this.props.item.video_length,
              }).toFormat("mm:ss")}
          </div>
        )}
      </div>
    );
  }
}
//
