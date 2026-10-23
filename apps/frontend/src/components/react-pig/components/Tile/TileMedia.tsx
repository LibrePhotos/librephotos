import React, { useState } from "react";
import type { ImageItem, LaidOutTile, PigSettings, ScrollSpeed, TileUrl } from "../../types";
import getImageHeight from "../../utils/getImageHeight";
import { ExpandedClip, GridClip, PreviewClip } from "./TileClips";
import { TileImages } from "./TileImages";

/**
 * What a tile shows: nothing yet (a placeholder), pictures (a photo, or a video whose square is a
 * still, #649), a video's still poster with its clip on hover (#2026), or, for a video scanned
 * before posters existed, the clip itself.
 */
type MediaKind = "none" | "images" | "poster" | "clip";

function tileMediaKind(item: ImageItem, clipFailed: boolean): MediaKind {
  if (item.isTemp) return "none";
  const isVideo = item.type !== undefined && item.type.includes("video");
  if (!isVideo || item.animated_preview === false) return "images";
  if (item.video_poster === true) return "poster";
  // A clip that fails to load shows the square as a still: one the list did not know about yet (a
  // rescan replaced the clip), or else the tile's colour shows through the broken image as before.
  return clipFailed ? "images" : "clip";
}

/** Whether the tile shows a video's still poster, and its clip only on hover or focus. */
export function showsPoster(item: ImageItem): boolean {
  return tileMediaKind(item, false) === "poster";
}

type Props = Readonly<{
  item: LaidOutTile<ImageItem>;
  getUrl: TileUrl;
  useLqip: boolean;
  containerWidth: number;
  scrollSpeed: ScrollSpeed;
  settings: Pick<PigSettings, "thumbnailSize" | "expandedSize">;
  isExpanded: boolean;
  /** Whether the pointer rests on the tile or it has keyboard focus; only a poster tile uses it. */
  previewing: boolean;
}>;

/** The pictures or clips inside a tile's button. */
export function TileMedia({
  item,
  getUrl,
  useLqip,
  containerWidth,
  scrollSpeed,
  settings,
  isExpanded,
  previewing,
}: Props) {
  const [clipFailed, setClipFailed] = useState(false);
  const kind = tileMediaKind(item, clipFailed);
  if (kind === "none") return null;
  // A placeholder has no image yet; a loaded tile always has one.
  const imageHash = item.image_hash ?? "";
  const gridHeight = getImageHeight(containerWidth);
  const showFull = scrollSpeed === "slow";
  const onClipError = () => setClipFailed(true);
  const expandedClip = isExpanded && kind !== "images" && (
    <ExpandedClip src={getUrl(imageHash, settings.expandedSize)} onFailed={onClipError} />
  );

  if (kind === "clip") {
    return (
      <>
        {showFull && <GridClip src={getUrl(imageHash, gridHeight)} onFailed={onClipError} />}
        {expandedClip}
      </>
    );
  }

  const poster = kind === "poster";
  return (
    <>
      <TileImages
        urlFor={size => getUrl(imageHash, size, poster)}
        useLqip={useLqip}
        showFull={showFull}
        gridHeight={gridHeight}
        thumbnailSize={settings.thumbnailSize}
        width={item.style.width}
        height={item.style.height}
        expandedSrc={isExpanded && !poster ? getUrl(imageHash, settings.expandedSize) : null}
      />
      {poster && previewing && showFull && !clipFailed && (
        <PreviewClip src={getUrl(imageHash, gridHeight)} onFailed={onClipError} />
      )}
      {expandedClip}
    </>
  );
}
