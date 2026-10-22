import { Button, Text } from "@mantine/core";
import { IconFaceId } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { formatVideoTime } from "../../util/dateUtils";
import type { VideoStartNotice } from "./useVideoStart";
import classes from "./VideoStartNote.module.css";

type Props = Readonly<{
  notice: VideoStartNotice | null;
  onPlayFromStart: () => void;
}>;

/** The words of the note: where it started, or why it could not, with or without a name. */
function useNoticeText(notice: VideoStartNotice): string {
  const { t } = useTranslation();
  const time = formatVideoTime(notice.seconds);
  const name = notice.name ?? "";
  if (notice.kind === "unseekable") {
    return name
      ? t("lightbox.videostart.unseekablenamed", { time, name })
      : t("lightbox.videostart.unseekable", { time });
  }
  return name ? t("lightbox.videostart.startednamed", { time, name }) : t("lightbox.videostart.started", { time });
}

/**
 * A short note over the top of the video after it jumped to a face (#2762), so a video that does
 * not start at 0:00 does not look broken: "Started at 0:42, where Anna appears · Play from start".
 * A status region, so a screen reader says it too.
 */
export function VideoStartNote({ notice, onPlayFromStart }: Props) {
  if (!notice) return null;
  return <Note notice={notice} onPlayFromStart={onPlayFromStart} />;
}

function Note({ notice, onPlayFromStart }: Readonly<{ notice: VideoStartNotice; onPlayFromStart: () => void }>) {
  const { t } = useTranslation();
  const text = useNoticeText(notice);
  return (
    <div className={classes.note} role="status">
      <IconFaceId size={16} aria-hidden="true" className={classes.icon} />
      <Text size="sm" c="white" className={classes.text}>
        {text}
      </Text>
      {notice.kind === "started" && (
        <Button size="compact-xs" variant="white" color="dark" className={classes.button} onClick={onPlayFromStart}>
          {t("lightbox.videostart.fromstart")}
        </Button>
      )}
    </div>
  );
}
