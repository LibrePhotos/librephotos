import { ActionIcon, Image, Popover } from "@mantine/core";
import React from "react";
import { Photo } from "tabler-icons-react";

import { serverAddress } from "../../api_client/apiClient";

type Props = {
  photo: string;
};

export function PhotoIcon({ photo }: Props) {

  return (
    <div style={{ left: 0, bottom: 0, position: "absolute" }}>
      <Popover position="bottom" width={300}>
        <Popover.Target>
          <ActionIcon variant="filled">
            <Photo />
          </ActionIcon>
        </Popover.Target>

        <Popover.Dropdown>
          <Image height={300} src={`${serverAddress}/media/thumbnails_big/${photo}`} />
        </Popover.Dropdown>
      </Popover>
    </div>
  );
}
