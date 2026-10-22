import type { Photo } from "@librephotos/api-client";
import type { ViewerSlide } from "@/db/queries/detail";

/** What the choice reads from the photo's details (null until they are in). */
export type OriginalDetails = Pick<Photo, "image_path"> &
  Partial<Pick<Photo, "original_mime_type" | "local_orientation">>;

/** Why a zoomed photo stays on the big thumbnail. */
export type PreviewReason = "raw" | "tiff" | "jxl" | "other" | "rotated";

/**
 * Which file a slide shows (#2743):
 * - `thumbnail`: the big thumbnail (or the camera-roll file), with nothing to say.
 * - `original`: the original; `zoom` when the user zoomed in to get it, which is
 *   what the resolution chip reports on (an animated GIF or a motion photo is
 *   shown as the original from the start and needs no chip).
 * - `preview`: zoomed in, but the device cannot draw the original.
 */
export type SlideSource =
  | { kind: "thumbnail" }
  | { kind: "original"; zoom: boolean }
  | { kind: "preview"; reason: PreviewReason };

/** What iOS and Android draw through expo-image. HEIC/HEIF too, unlike a web browser. */
const DRAWABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/gif",
  "image/apng",
]);
const ANIMATED_TYPES = new Set(["image/gif", "image/apng"]);
/** The backend's one type for every camera RAW (`api.mime.RAW_MIME_TYPE`). */
const RAW_TYPE = "image/x-dcraw";

const PREVIEW_REASONS: Partial<Record<string, PreviewReason>> = {
  [RAW_TYPE]: "raw",
  "image/tiff": "tiff",
  "image/jxl": "jxl",
};

/** Does this photo's file animate? Its big thumbnail would be a still frame. */
function isAnimated(details: OriginalDetails | null): boolean {
  const mime = details?.original_mime_type;
  // A server before original_mime_type: guess from the file names, as before.
  if (!mime) return !!details?.image_path.some((path) => path.toLowerCase().endsWith(".gif"));
  return ANIMATED_TYPES.has(mime);
}

/** The original, once zoomed into: when the device can draw it and it shows the photo as LibrePhotos does. */
function zoomedSource(details: OriginalDetails | null): SlideSource {
  const mime = details?.original_mime_type;
  // Details not in yet, or a server that does not say: keep the thumbnail.
  if (!mime) return { kind: "thumbnail" };
  if (!DRAWABLE_TYPES.has(mime)) return { kind: "preview", reason: PREVIEW_REASONS[mime] ?? "other" };
  // The file does not carry a turn the user gave the photo in LibrePhotos.
  if ((details.local_orientation ?? 1) !== 1) return { kind: "preview", reason: "rotated" };
  return { kind: "original", zoom: true };
}

/**
 * Which file `slide` shows. Only the active slide ever gets an original: a
 * pager window holds hundreds of slides, and originals are full-size files.
 */
export function slideSource(
  slide: Pick<ViewerSlide, "type" | "image_hash" | "local_uri">,
  active: boolean,
  zoomedOnce: boolean,
  details: OriginalDetails | null
): SlideSource {
  // A camera-roll slide renders from its own file already.
  if (slide.local_uri || !slide.image_hash) return { kind: "thumbnail" };
  // A motion photo's still is its original, on every slide (the server's still for it).
  if (slide.type === "motion_photo") return { kind: "original", zoom: false };
  if (!active) return { kind: "thumbnail" };
  if (isAnimated(details)) return { kind: "original", zoom: false };
  return zoomedOnce ? zoomedSource(details) : { kind: "thumbnail" };
}
