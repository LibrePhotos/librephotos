import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import { describeDuration, parsePhotoTimestamp } from "../../../../util/dateUtils";
import { isPhotoSphere } from "../../../panorama/photoSphere";
import type { ImageItem } from "../../types";

function takenDate(item: Pick<ImageItem, "date">): string | null {
  // exif_timestamp is the camera's wall clock tagged as UTC: read it in UTC.
  const taken = item.date ? parsePhotoTimestamp(item.date) : null;
  return taken?.isValid ? taken.toLocaleString(DateTime.DATETIME_MED) : null;
}

type LabelledItem = Pick<ImageItem, "date" | "is_hdr" | "projection_type">;

function mediaLabel(item: LabelledItem, isVideo: boolean, t: TFunction): string {
  const date = takenDate(item);
  // The HDR and 360° badges are hidden from assistive tech, so the label says them.
  if (isVideo && item.is_hdr) return date ? t("phototile.hdrvideotaken", { date }) : t("phototile.hdrvideolabel");
  if (isVideo) return date ? t("phototile.videotaken", { date }) : t("phototile.video");
  if (isPhotoSphere(item)) return date ? t("phototile.spheretaken", { date }) : t("phototile.sphere");
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
  item: LabelledItem & Pick<ImageItem, "video_length">,
  isVideo: boolean,
  t: TFunction
): string {
  const label = mediaLabel(item, isVideo, t);
  const length = isVideo ? spokenLength(item.video_length) : null;
  return length ? t("phototile.withlength", { label, length }) : label;
}
