import { Media, type PigPhoto } from "@librephotos/api-client";
import {
  IconLayersLinked,
  IconPlayerPlayFilled as PlayerPlay,
  IconRun as Run,
  IconStack2 as Stack,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { formatVideoTime } from "../../util/dateUtils";
import { isPhotoSphere } from "../panorama/photoSphere";
import { TILE_GLYPH_SIZE, TileBadge, TileCorner } from "./TileBadge";

type Item = Pick<PigPhoto, "type" | "video_length" | "is_hdr" | "projection_type" | "stacks" | "has_raw_variant">;

/**
 * Most phones have recorded HDR by default for years, and the tile shows it converted to SDR: the
 * badge says there is more to the video than that. The tile button's aria-label already says "HDR
 * video", so the badge is not read out a second time.
 */
function HdrBadge() {
  const { t } = useTranslation();
  return (
    <TileBadge title={t("phototile.hdrvideo")} aria-hidden="true">
      HDR
    </TileBadge>
  );
}

/** A 360° photo sphere (#483): it opens flat, and "360° view" in the lightbox looks around in it. */
function SphereBadge() {
  const { t } = useTranslation();
  return (
    <TileBadge title={t("phototile.spherebadge")} aria-hidden="true">
      360°
    </TileBadge>
  );
}

/** A photo with a RAW file (`has_raw_variant`), or a legacy RAW+JPEG stack. */
function hasRaw(item: Item): boolean {
  const legacyRawStack = item.stacks?.length === 1 && item.stacks[0]?.type === "raw_jpeg";
  return item.has_raw_variant === true || legacyRawStack === true;
}

/** The photo's stacks (bursts, brackets, duplicates): one shows its photo count, several their number. */
function StackBadge({ item }: Readonly<{ item: Item }>) {
  const stacks = item.stacks?.filter(stack => stack.type !== "raw_jpeg" && stack.type !== "live_photo") ?? [];
  const first = stacks[0];
  if (!first) return null;
  const several = stacks.length > 1;
  const Icon = several ? IconLayersLinked : Stack;
  let count: number | null = null;
  if (several) count = stacks.length;
  else if (first.photo_count > 1) count = first.photo_count;
  return (
    <TileBadge>
      <Icon size={TILE_GLYPH_SIZE} stroke={2.25} aria-hidden="true" />
      {count}
    </TileBadge>
  );
}

/** A video's or motion photo's glyph and length ("0:07"). */
function DurationBadge({ item }: Readonly<{ item: Item }>) {
  const seconds = Number(item.video_length);
  const length = item.video_length && Number.isFinite(seconds) ? formatVideoTime(seconds) : null;
  return (
    <TileBadge>
      {item.type === Media.MOTION_PHOTO ? (
        <Run size={TILE_GLYPH_SIZE} stroke={2.25} aria-hidden="true" />
      ) : (
        <PlayerPlay size={TILE_GLYPH_SIZE - 2} aria-hidden="true" />
      )}
      {length}
    </TileBadge>
  );
}

/**
 * A tile's top-right corner: what kind of file it is. Stack count, RAW, HDR or 360°, then a video's
 * length nearest the corner, all in one badge style (review r6 #10).
 */
export function TopRightOverlay({ item }: Readonly<{ item: Item }>) {
  const isVideo = item.type === Media.VIDEO || item.type === Media.MOTION_PHOTO;
  const sphere = item.type === Media.IMAGE && isPhotoSphere(item);
  return (
    <TileCorner position="top">
      <StackBadge item={item} />
      {hasRaw(item) && <TileBadge>RAW</TileBadge>}
      {sphere && <SphereBadge />}
      {item.type === Media.VIDEO && item.is_hdr && <HdrBadge />}
      {isVideo && <DurationBadge item={item} />}
    </TileCorner>
  );
}
