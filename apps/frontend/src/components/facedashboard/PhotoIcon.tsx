import { ActionIcon, Image, Popover } from "@mantine/core";
import React, { useState } from "react";
import { Photo } from "tabler-icons-react";

import { serverAddress } from "../../api_client/apiClient";

type Props = {
  photo: string;
};

export function PhotoIcon(props: Props) {
  const [opened, setOpened] = useState(false);
  return (
    <div style={{ left: 6, bottom: 6, position: "absolute" }}>
      <Popover
        target={
          <ActionIcon onClick={() => setOpened(o => !o)} variant="filled">
            <Photo />
          </ActionIcon>
        }
        withArrow
        width={500}
        opened={opened}
        onClose={() => setOpened(false)}
      >
        <Image src={`${serverAddress}/media/thumbnails_big/${props.photo}`} />
      </Popover>
    </div>
  );
}
