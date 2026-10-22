import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import { describeDuration, parsePhotoTimestamp } from "../../../../util/dateUtils";
import type { ImageItem } from "../../types";

function takenDate(item: Pick<ImageItem, "date">): string | null {
  // exif_timestamp is the camera's wall clock tagged as UTC: read it in UTC.
  const taken = item.date ? parsePhotoTimestamp(item.date) : null;
  return taken?.isValid ? taken.toLocaleString(DateTime.DATETIME_MED) : null;
}

function mediaLabel(item: Pick<ImageItem, "date" | "is_hdr">, isVideo: boolean, t: TFunction): string {
  const date = takenDate(item);
  // The HDR badge is hidden from assistive tech, so the label says it.
  if (isVideo && item.is_hdr) return date ? t("phototile.hdrvideotaken", { date }) : t("phototile.hdrvideolabel");
  if (isVideo) return date ? t("phototile.videotaken", { date }) : t("phototile.video");
  return date ? t("phototile.phototaken", { date }) : t("phototile.photo");
}

/** A video's length spelled out ("42 seconds"), or null when it is unknown or under a second. */
function spokenLength(videoLength: string | undefined): string | null {
  const seconds = Math.round(Number(videoLength));
  return Number.isFinite(seconds) && seconds >= 1 ? describeDuration(seconds) : null;
}

/**
 * The name of a tile's button. Every image in the tile is decorative (alt=""), so the button says
 * what it opens: the kind of media, when it was taken and, for a video, how long it is (the
 * duration on the tile is drawn for sighted users only).
 */
export function tileLabel(
  item: Pick<ImageItem, "date" | "is_hdr" | "video_length">,
  isVideo: boolean,
  t: TFunction
): string {
  const label = mediaLabel(item, isVideo, t);
  const length = isVideo ? spokenLength(item.video_length) : null;
  return length ? t("phototile.withlength", { label, length }) : label;
}
