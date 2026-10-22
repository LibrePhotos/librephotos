import { Button } from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { formatVideoTime } from "../../util/dateUtils";
import { useLightboxCommands } from "./lightboxCommands";
import classes from "./VideoTimeButton.module.css";

type Props = Readonly<{
  /** The second of the video the face was found at. */
  seconds: number;
  /** The face's person, empty when nobody named it. */
  name: string;
}>;

/**
 * "▷ 0:42" next to a face found in a later frame of a video (#2762): plays the video from there.
 * The player is told through the lightbox commands, so the photo page and the lightbox both work.
 */
export function VideoTimeButton({ seconds, name }: Props) {
  const { t } = useTranslation();
  const commands = useLightboxCommands();
  const time = formatVideoTime(seconds);
  return (
    <Button
      size="compact-xs"
      variant="light"
      className={classes.button}
      leftSection={<IconPlayerPlay size={12} aria-hidden="true" />}
      aria-label={
        name ? t("lightbox.videostart.playfromnamed", { time, name }) : t("lightbox.videostart.playfrom", { time })
      }
      onClick={() => commands.emit("seekTo", seconds, name)}
    >
      {time}
    </Button>
  );
}
