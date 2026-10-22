import { Media } from "@librephotos/api-client";
import { IconUser, IconPlayerPlay as PlayerPlay, IconRun as Run } from "@tabler/icons-react";
import { Duration } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { formatVideoTime } from "../../util/dateUtils";
import { isPhotoSphere } from "../panorama/photoSphere";
import { TileBadge } from "./TileBadge";
import classes from "./VideoOverlay.module.css";

type Props = Readonly<{
  item: {
    type: Media;
    video_length?: string;
    is_hdr?: boolean;
    projection_type?: string | null;
    person_video_time?: number | null;
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
/** A 360° photo sphere (#483): it opens flat, and "360° view" in the lightbox looks around in it. */
function SphereBadge() {
  const { t } = useTranslation();
  // The tile button's aria-label says "360° photo", as with HDR.
  return (
    <TileBadge title={t("phototile.spherebadge")} aria-hidden="true" className={classes.sphereBadge}>
      360°
    </TileBadge>
  );
}

/** In a person's photos: the moment of the video the person is at, where it opens (#2762). */
function PersonMomentBadge({ seconds }: Readonly<{ seconds: number }>) {
  const { t } = useTranslation();
  const time = formatVideoTime(seconds);
  return (
    <TileBadge title={t("phototile.personvideotime", { time })} className={classes.moment}>
      <IconUser size={10} stroke={2.5} aria-hidden="true" />
      {time}
    </TileBadge>
  );
}

/** The bottom-right corner of a tile: a video's length and HDR badge, or a photo sphere's 360° badge. */
export function VideoOverlay({ item }: Props) {
  // video_length is the duration in seconds, as a string.
  function getDuration(videoLength: string) {
    return (
      // No top margin: it pushed the text below the play icon's centre line.
      <span style={{ marginRight: 5 }}>{Duration.fromObject({ seconds: Number(videoLength) }).toFormat("mm:ss")}</span>
    );
  }

  if (item.type === Media.IMAGE && isPhotoSphere(item)) return <SphereBadge />;
  if (![Media.VIDEO, Media.MOTION_PHOTO].includes(item.type)) {
    return <div />;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", color: "white", padding: "0 5px 5px 0" }}>
      {typeof item.person_video_time === "number" && <PersonMomentBadge seconds={item.person_video_time} />}
      {item.type === Media.VIDEO && item.is_hdr && <HdrBadge />}
      {item.type === Media.MOTION_PHOTO ? <Run /> : <PlayerPlay />}
      {item.video_length && item.video_length !== "None" && getDuration(item.video_length)}
    </div>
  );
}
