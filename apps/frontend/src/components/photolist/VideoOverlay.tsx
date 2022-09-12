import { createStyles } from "@mantine/core";
import { Duration } from "luxon";
import React from "react";
import { PlayerPlay } from "tabler-icons-react";

type Props = {
  item: {
    type: string;
    video_length: string;
  };
};

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

  if (item.type !== "video") {
    return <div />;
  }

  return (
    <div className={classes.container}>
      <PlayerPlay />
      {item.video_length && item.video_length !== "None" && getDuration(item)}
    </div>
  );
}
