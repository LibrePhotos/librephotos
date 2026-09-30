import { IconPlayerPlay as PlayerPlay, IconRun as Run } from "@tabler/icons-react";
import { Duration } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { Media } from "../../api_client/photos/types";

type Props = Readonly<{
  item: {
    type: Media;
    video_length: string;
    is_hdr?: boolean;
  };
}>;

/**
 * Most phones have recorded HDR by default for years, and the tile shows it
 * converted to SDR -- the badge says there is more to the video than that.
 */
function HdrBadge() {
  const { t } = useTranslation();
  return (
    <span
      title={t("phototile.hdrvideo")}
      style={{
        margin: "5px 5px 0 0",
        padding: "0 4px",
        border: "1px solid currentColor",
        borderRadius: 3,
        fontSize: "0.7em",
        fontWeight: 700,
        lineHeight: 1.4,
      }}
    >
      HDR
    </span>
  );
}
export function VideoOverlay({ item }: Props) {
  function getDuration({ video_length }) {
    return (
      <span style={{ margin: "5px 5px 0 0" }}>{Duration.fromObject({ seconds: video_length }).toFormat("mm:ss")}</span>
    );
  }

  if (![Media.VIDEO, Media.MOTION_PHOTO].includes(item.type)) {
    return <div />;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", color: "white", padding: "0 5px 5px 0" }}>
      {item.type === Media.VIDEO && item.is_hdr && <HdrBadge />}
      {item.type === Media.MOTION_PHOTO ? <Run /> : <PlayerPlay />}
      {item.video_length && item.video_length !== "None" && getDuration(item)}
    </div>
  );
}
