import { createStyles } from "@mantine/core";
import { IconPlayerPlay as PlayerPlay, IconRun as Run } from "@tabler/icons-react";
import { Duration } from "luxon";
import React from "react";

import { MediaType } from "../../actions/photosActions.types";

type Props = Readonly<{
  item: {
    type: MediaType;
    video_length: string;
  };
}>;

const styles = createStyles(() => ({
  container: {
    display: "flex",
    alignItems: "center",
    color: "white",
    padding: "0 0 5px 5px",
  },

  duration: {
    margin: "5px 0 0 5px",
  },
}));

export function VideoOverlay({ item }: Props) {
  const { classes } = styles();

  function getDuration({ video_length }) {
    return <span className={classes.duration}>{Duration.fromObject({ seconds: video_length }).toFormat("mm:ss")}</span>;
  }

  if (![MediaType.VIDEO, MediaType.MOTION_PHOTO].includes(item.type)) {
    return <div />;
  }

  return (
    <div className={classes.container}>
      {item.type === MediaType.MOTION_PHOTO ? <Run /> : <PlayerPlay />}
      {item.video_length && item.video_length !== "None" && getDuration(item)}
    </div>
  );
}
