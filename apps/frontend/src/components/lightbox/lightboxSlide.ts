import type { Photo, PhotoOcrBlock } from "@librephotos/api-client";
import { LIGHTBOX_PHOTO_HEIGHT, LIGHTBOX_VIDEO_HEIGHT } from "./MediaDisplay";

/**
 * What the main slide shows the item as, and the height of its media box. Whether the original or
 * a conversion is played is decided from the details (`video_playback_type`), so a video waits for
 * them as its poster rather than starting the original and restarting on the converted stream. A
 * public page fetches no details and does not wait.
 */
export function mainSlide(type: string, isPublic: boolean, detailsLoading: boolean) {
  const mainType = type === "video" && !isPublic && detailsLoading ? "photo" : type;
  const isVideo = mainType === "video" || mainType === "embedded";
  return { mainType, mediaBoxHeight: isVideo ? LIGHTBOX_VIDEO_HEIGHT : LIGHTBOX_PHOTO_HEIGHT };
}

/** The photo's recognised text blocks for live text, or undefined when there are none to show. */
export function liveTextBlocks(details: Pick<Photo, "ocr"> | null | undefined, type: string) {
  const blocks: PhotoOcrBlock[] | undefined = details?.ocr?.blocks ?? undefined;
  return type === "photo" && blocks && blocks.length > 0 ? blocks : undefined;
}
