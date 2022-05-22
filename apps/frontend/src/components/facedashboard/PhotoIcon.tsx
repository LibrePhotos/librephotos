import { Image } from "@mantine/core";
import React from "react";
import { Icon, Popup } from "semantic-ui-react";

import { serverAddress } from "../../api_client/apiClient";

type Props = {
  photo: string;
};

export function PhotoIcon(props: Props) {
  return (
    <div style={{ left: 6, bottom: 6, position: "absolute" }}>
      <Popup
        trigger={<Icon circular style={{ backgroundColor: "white" }} color="black" name="image" />}
        on="focus"
        flowing
        hideOnScroll
        inverted
        content={<Image src={`${serverAddress}/media/thumbnails_big/${props.photo}`} />}
      />
    </div>
  );
}
