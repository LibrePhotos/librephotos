import { ActionIcon, Image, Popover } from "@mantine/core";
import React, { useState } from "react";
import { Photo } from "tabler-icons-react";

import { serverAddress } from "../../api_client/apiClient";

type Props = {
  photo: string;
};

export function PhotoIcon({ photo }: Props) {
  const [opened, setOpened] = useState(false);

  return (
    <div style={{ left: 0, bottom: 0, position: "absolute" }}>
      <Popover
        target={
          <ActionIcon onClick={() => setOpened(o => !o)} variant="filled">
            <Photo />
          </ActionIcon>
        }
        onScroll={() => setOpened(false)}
        opened={opened}
        position="bottom"
        onClose={() => setOpened(false)}
      >
        <Image height={300} src={`${serverAddress}/media/thumbnails_big/${photo}`} />
      </Popover>
    </div>
  );
}
