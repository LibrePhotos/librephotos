import type { Photo } from "@librephotos/api-client";

/** What the zoom decision reads from the photo's details. */
export type OriginalZoomDetails = Partial<
  Pick<Photo, "original_mime_type" | "width" | "height" | "local_orientation" | "video">
>;

export type PixelSize = { width: number; height: number };

/** Why zooming stays on the big thumbnail although the original is bigger. */
export type PreviewReason = "raw" | "heic" | "tiff" | "jxl" | "other" | "rotated";

/**
 * What zooming in shows (#2742):
 * - `none`: nothing to say (a public page, a video, a neighbouring slide, details not in yet).
 * - `original`: the picture on screen is already the original (an animated GIF, or a photo no
 *   bigger than its thumbnail); `size` is the original's, when the server knows it.
 * - `load`: load the original on the first zoom and swap to it.
 * - `preview`: keep the thumbnail, for `reason`.
 */
export type OriginalZoomPlan =
  | { kind: "none" }
  | { kind: "original"; size: PixelSize | null }
  | { kind: "load" }
  | { kind: "preview"; reason: PreviewReason };

/** Animated images: the original is shown from the start, or the animation would be lost. */
const ANIMATED_TYPES = new Set(["image/gif", "image/apng"]);
/** Stills every current browser draws in an <img>. */
const DRAWABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
/** The backend's one type for every camera RAW (`api.mime.RAW_MIME_TYPE`). */
const RAW_TYPE = "image/x-dcraw";

const PREVIEW_REASONS: Partial<Record<string, PreviewReason>> = {
  [RAW_TYPE]: "raw",
  "image/heic": "heic",
  "image/heif": "heic",
  "image/tiff": "tiff",
  "image/jxl": "jxl",
};

/** Whether the original is shown in place of the thumbnail from the start (it animates). */
export function isAnimatedOriginal(details: OriginalZoomDetails | null | undefined): boolean {
  return ANIMATED_TYPES.has(details?.original_mime_type ?? "");
}

function knownSize(details: OriginalZoomDetails): PixelSize | null {
  const { width, height } = details;
  return width && height ? { width, height } : null;
}

/** Whether the original has more pixels to show than the loaded thumbnail. */
function biggerThan(original: PixelSize | null, thumbnail: PixelSize | null): boolean {
  // Unknown either way: load it, a needless load costs only the bytes.
  if (!original || !thumbnail) return true;
  // The longer edges, so a rotation that swapped width and height does not matter.
  return Math.max(original.width, original.height) > Math.max(thumbnail.width, thumbnail.height);
}

export type OriginalZoomInput = {
  details: OriginalZoomDetails | null | undefined;
  isMainContent: boolean;
  /** A public page: the original is not offered there (it would need its own security review). */
  isPublic: boolean;
  /** The big thumbnail's natural size, once it has loaded. */
  thumbnailSize: PixelSize | null;
  /** Turned in this lightbox session: the details may not say so yet. */
  rotatedHere: boolean;
};

/** What zooming into the photo shows; see OriginalZoomPlan. */
export function originalZoomPlan(input: OriginalZoomInput): OriginalZoomPlan {
  const { details, isMainContent, isPublic } = input;
  const mime = details?.original_mime_type;
  if (!isMainContent || isPublic || !details || details.video || !mime) return { kind: "none" };
  if (ANIMATED_TYPES.has(mime)) return { kind: "original", size: knownSize(details) };
  if (!DRAWABLE_TYPES.has(mime)) return { kind: "preview", reason: PREVIEW_REASONS[mime] ?? "other" };
  // The browser draws the file as it is, without the turn the user gave it in LibrePhotos.
  if (input.rotatedHere || (details.local_orientation ?? 1) !== 1) return { kind: "preview", reason: "rotated" };
  const size = knownSize(details);
  return biggerThan(size, input.thumbnailSize) ? { kind: "load" } : { kind: "original", size };
}
