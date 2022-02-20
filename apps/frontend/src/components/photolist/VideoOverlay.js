import React, { Component } from "react";
import { Icon, Button } from "semantic-ui-react";
import { Duration } from "luxon";
export default class VideoOverlay extends Component {
  render() {
    return (
      <div>
        {this.props.item.type == "video" && (
          <div style={{ padding: 5, color: "white" }}>
            <Icon name="play" inverted />
            {this.props.item.video_length &&
              Duration.fromObject({
                seconds: this.props.item.video_length,
              }).toFormat("mm:ss")}
          </div>
        )}
      </div>
    );
  }
}
