import { IconPlayerPlay as PlayerPlay, IconRun as Run } from "@tabler/icons-react";
import { Duration } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { Media } from "../../api_client/photos/types";
import { TileBadge } from "./TileBadge";

type Props = Readonly<{
  item: {
    type: Media;
    video_length?: string;
    is_hdr?: boolean;
  };
}>;

/**
 * Most phones have recorded HDR by default for years, and the tile shows it
 * converted to SDR -- the badge says there is more to the video than that.
 */
function HdrBadge() {
  const { t } = useTranslation();
  // Same filled badge as RAW. The tile button's aria-label already says "HDR
  // video", so the badge is not read out a second time.
  return (
    <TileBadge title={t("phototile.hdrvideo")} aria-hidden="true" style={{ marginRight: 5, flexShrink: 0 }}>
      HDR
    </TileBadge>
  );
}
export function VideoOverlay({ item }: Props) {
  // video_length is the duration in seconds, as a string.
  function getDuration(videoLength: string) {
    return (
      // No top margin: it pushed the text below the play icon's centre line.
      <span style={{ marginRight: 5 }}>{Duration.fromObject({ seconds: Number(videoLength) }).toFormat("mm:ss")}</span>
    );
  }

  if (![Media.VIDEO, Media.MOTION_PHOTO].includes(item.type)) {
    return <div />;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", color: "white", padding: "0 5px 5px 0" }}>
      {item.type === Media.VIDEO && item.is_hdr && <HdrBadge />}
      {item.type === Media.MOTION_PHOTO ? <Run /> : <PlayerPlay />}
      {item.video_length && item.video_length !== "None" && getDuration(item.video_length)}
    </div>
  );
}
