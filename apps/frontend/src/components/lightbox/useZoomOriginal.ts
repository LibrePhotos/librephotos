import { mediaUrl } from "../../api_client/media/mediaUrl";
import { isAnimatedOriginal, originalZoomPlan, type OriginalZoomDetails, type PixelSize } from "./originalZoom";
import { chipState, type ChipState } from "./ResolutionChip";
import { useOriginalImage } from "./useOriginalImage";

type Args = {
  /** The photo's hash; undefined for an empty neighbouring slide. */
  mediaHash: string | undefined;
  /** Bumped after a rotation, so the browser drops its cached copies. */
  imageCacheKey: number;
  details: OriginalZoomDetails | null | undefined;
  isMainContent: boolean;
  isPublic: boolean;
  /** The big thumbnail's natural size, once it has loaded. */
  thumbnailSize: PixelSize | null;
  /** Zoomed in (the zoom toggle or a pinch). */
  magnified: boolean;
};

export type ZoomOriginal = {
  /** What the <img> shows. */
  src: string;
  /** The original replaced the thumbnail after a zoom; the face boxes stay in thumbnail pixels. */
  swapped: boolean;
  /** What the resolution chip says; null for no chip. */
  chip: ChipState | null;
  retry: () => void;
  originalUrl: string;
  /**
   * What the 360° viewer draws a photo sphere from (#483): the original where zooming may load it,
   * so the sphere is sharp, else the big thumbnail (a public page, a HEIC, a turned photo).
   */
  panoramaSrc: string;
};

/**
 * Which file the lightbox's photo shows (#2742): the big thumbnail, swapped
 * for the original once the user zooms into a photo whose original the
 * browser can draw and that is bigger; an animated original from the start.
 */
export function useZoomOriginal(args: Args): ZoomOriginal {
  const { mediaHash = "", imageCacheKey, details, isMainContent, magnified } = args;
  const version = imageCacheKey ? `?v=${imageCacheKey}` : "";
  const originalUrl = `${mediaUrl.photo(mediaHash)}${version}`;
  const plan = originalZoomPlan({
    details,
    isMainContent,
    isPublic: args.isPublic,
    thumbnailSize: args.thumbnailSize,
    rotatedHere: imageCacheKey !== 0,
  });
  const original = useOriginalImage(plan.kind === "load" && mediaHash ? originalUrl : null, magnified);
  const swapped = original.status === "loaded";
  const animated = isMainContent && isAnimatedOriginal(details);
  const thumbnailUrl = `${mediaUrl.bigThumbnail(mediaHash)}${version}`;
  const originalAllowed = plan.kind === "load" || plan.kind === "original";
  return {
    src: swapped || animated ? originalUrl : thumbnailUrl,
    swapped,
    chip: chipState(plan, original),
    retry: original.retry,
    originalUrl,
    panoramaSrc: originalAllowed ? originalUrl : thumbnailUrl,
  };
}
