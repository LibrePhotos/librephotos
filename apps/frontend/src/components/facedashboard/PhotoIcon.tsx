import React from "react";
import { Popup, Icon } from "semantic-ui-react";
import { SecuredImageJWT } from "../../components/SecuredImage";

import { serverAddress } from "../../api_client/apiClient";

type Props = {
  photo: string;
};

export const PhotoIcon = (props: Props) => {
  return (
    <div style={{ left: 6, bottom: 6, position: "absolute" }}>
      <Popup
        trigger={
          <Icon
            circular
            style={{ backgroundColor: "white" }}
            color="black"
            name="image"
          />
        }
        on="focus"
        flowing
        hideOnScroll
        inverted
        content={
          <SecuredImageJWT
            size="large"
            src={serverAddress + "/media/thumbnails_big/" + props.photo}
          />
        }
      />
    </div>
  );
};
