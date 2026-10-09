import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import type { NormalizedFaceBox } from "../../api_client/faces/hooks/useAddFaceMutation";
import type { PhotoOcrBlock } from "../../api_client/photos/types";
import { convertedUrl, needsConversion } from "../../util/videoPlayback";
import { FaceDrawLayer } from "./FaceDrawLayer";
import { FaceOverlay } from "./FaceOverlay";
import type { FaceLocationType } from "./lightbox.types";
import { OcrTextOverlay } from "./OcrTextOverlay";
import { VideoPlayer } from "./VideoPlayer";

/** How tall the lightbox's media box is; the carousel arrows centre on it. */
export const LIGHTBOX_PHOTO_HEIGHT = "82vh";
// The box starts 48px down, under the toolbar, and the thumbnail strip floats
// over the bottom 96px of the lightbox. A video's native seek bar is at its
// bottom edge, so on a short window the video stops short of the strip instead
// of running under it.
export const LIGHTBOX_VIDEO_HEIGHT = "min(82vh, calc(100vh - 160px))";
/** The tallest a video gets outside the lightbox. */
const PAGE_VIDEO_MAX_HEIGHT = "70vh";

/** What a screen reader says for the photo: its caption, else its file name. */
function describePhoto(photoDetails: any): string {
  const captions = photoDetails?.captions_json;
  const caption = captions?.user_caption || captions?.im2txt;
  if (typeof caption === "string" && caption.trim()) return caption.trim();
  const path = photoDetails?.image_path?.[0];
  return typeof path === "string" ? (path.split(/[\\/]/).pop() ?? "") : "";
}

export type MediaDisplayProps = {
  id: string | undefined;
  image_hash?: string | undefined;
  isMainContent?: boolean;
  type: string;
  bind?: any;
  faceLocation: FaceLocationType;
  toggleZoom?: () => void;
  scale?: number;
  offset?: { x: number; y: number };
  handleDragStart: (event: React.DragEvent) => void;
  fullHeight?: boolean;
  playing?: boolean;
  photoDetails?: any | null; // Allow null values from the API
  /** A public page: the server never converts for an anonymous visitor. */
  isPublic?: boolean;
  onEnded?: () => void;
  rotationAngle?: number;
  imageCacheKey?: number;
  suppressRotationTransition?: boolean;
  onImageLoad?: () => void;
  ocrBlocks?: PhotoOcrBlock[];
  showOcrText?: boolean;
  /** Marking a face the detector missed: the photo becomes a drawing surface. */
  drawingFace?: boolean;
  onFaceDrawn?: (box: NormalizedFaceBox) => void;
  onCancelDrawFace?: () => void;
};

export function MediaDisplay({
  id,
  image_hash,
  isMainContent = false,
  type,
  bind,
  faceLocation,
  toggleZoom,
  scale = 1,
  offset = { x: 0, y: 0 },
  handleDragStart,
  fullHeight = false,
  playing = false,
  photoDetails,
  isPublic = false,
  onEnded,
  rotationAngle = 0,
  imageCacheKey = 0,
  suppressRotationTransition = false,
  onImageLoad,
  ocrBlocks,
  showOcrText = false,
  drawingFace = false,
  onFaceDrawn,
  onCancelDrawFace,
}: MediaDisplayProps) {
  const { t } = useTranslation();
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Natural pixel size of the loaded image; drives the OCR overlay's aspect
  // ratio and is reset while a different image is loading.
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const mediaKey = `${image_hash || id}-${imageCacheKey}`;
  useEffect(() => {
    setNaturalSize(null);
  }, [mediaKey]);

  if (!id) return null;

  // Use image_hash for media URLs (files are stored by hash), fallback to id
  const mediaHash = image_hash || id;

  const imageDimensions = {
    width: imgRef.current?.naturalWidth ?? 1080,
    height: imgRef.current?.naturalHeight ?? 810,
  };

  const isGif = () => {
    if (!photoDetails?.image_path || !Array.isArray(photoDetails.image_path)) {
      return false;
    }
    return photoDetails.image_path.some((path: string) => path.toLowerCase().endsWith(".gif"));
  };

  const currentType = isMainContent ? type : "photo";
  // Outside the lightbox (the photo page) there is no box to fill: the video
  // takes the page's width at its own shape, capped like the photo there. A
  // fixed box left bands around a landscape clip, and the stored width and
  // height cannot shape one, since they ignore a phone video's rotation.
  const videoContainerHeight = fullHeight ? "auto" : LIGHTBOX_VIDEO_HEIGHT;
  const videoMaxHeight = fullHeight ? PAGE_VIDEO_MAX_HEIGHT : undefined;
  const thumbnailUrl = `${serverAddress}/media/thumbnails_big/${mediaHash}`;

  if (currentType === "video" || currentType === "embedded") {
    // Backend strips extension via fname.split(".")[0], so .mp4 suffix is safe
    // and helps the browser identify the content type for native playback.
    // The backend serves either the original file (via X-Accel-Redirect / FileResponse)
    // or a transcoded stream (StreamingHttpResponse): always with "Always
    // transcode videos" on, otherwise when asked with ?transcode=1 -- which is
    // done up front for a video this browser says it cannot play, and as a
    // fallback for one it turns out not to.
    const originalUrl = `${serverAddress}/media/photos/${mediaHash}.mp4`;
    const videoUrl =
      currentType === "video"
        ? needsConversion(photoDetails?.video_playback_type)
          ? convertedUrl(originalUrl)
          : originalUrl
        : `${serverAddress}/media/embedded_media/${mediaHash}`;
    // Not on a public page: the server answers ?transcode=1 there with the same
    // original, so the retry could only fail again and blame a conversion that
    // never ran.
    const fallbackUrl =
      currentType === "video" && videoUrl === originalUrl && !isPublic ? convertedUrl(originalUrl) : undefined;

    return (
      <VideoPlayer
        url={videoUrl}
        fallbackUrl={fallbackUrl}
        posterUrl={thumbnailUrl}
        mediaHash={mediaHash}
        height={videoContainerHeight}
        maxHeight={videoMaxHeight}
        controls={isMainContent}
        playing={isMainContent && playing}
        onEnded={isMainContent ? onEnded : undefined}
        // A motion photo's clip is served as it is, never converted.
        convertible={currentType === "video"}
      />
    );
  }

  // For GIFs, use the original photo endpoint to get the animated file
  // For regular photos, use the big thumbnail
  // Append a version param after rotation so the browser discards its cached copy
  const cacheBustingParam = imageCacheKey ? `?v=${imageCacheKey}` : "";
  const imageUrl =
    isGif() && isMainContent
      ? `${serverAddress}/media/photos/${mediaHash}${cacheBustingParam}`
      : `${serverAddress}/media/thumbnails_big/${mediaHash}${cacheBustingParam}`;

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    setNaturalSize({ width: naturalWidth, height: naturalHeight });
    if (isMainContent) onImageLoad?.();
  };

  // Shared by the image and the OCR overlay so the selectable text tracks
  // zoom, pan and rotation exactly.
  const mainTransition = isMainContent && !suppressRotationTransition ? "transform 0.3s ease-out" : "none";
  const mainTransform = isMainContent
    ? `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotationAngle}deg)`
    : "none";
  return (
    <div
      {...(isMainContent && bind ? bind() : {})}
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: fullHeight ? "100%" : LIGHTBOX_PHOTO_HEIGHT,
        borderRadius: "8px",
      }}
    >
      <div style={{ position: "relative" }}>
        <img
          ref={imgRef}
          src={imageUrl}
          // The neighbouring slides get no details, so they are just "Photo".
          alt={describePhoto(photoDetails) || t("phototile.photo")}
          loading="eager"
          onDragStart={handleDragStart}
          onDoubleClick={isMainContent && toggleZoom ? toggleZoom : undefined}
          onLoad={handleLoad}
          style={{
            transition: mainTransition,
            transform: mainTransform,
            // Block display so the wrapper matches the image exactly — the
            // inline baseline gap would offset the overlays a few pixels.
            display: "block",
            maxHeight: "82vh",
            maxWidth: "100%",
            borderRadius: 8,
            opacity: isMainContent ? 1 : 0.9,
            willChange: isMainContent ? "transform" : "auto",
            WebkitTapHighlightColor: "transparent",
            boxShadow: isMainContent ? "0 4px 16px rgba(0,0,0,0.1)" : "none",
          }}
        />
        {isMainContent && showOcrText && ocrBlocks && ocrBlocks.length > 0 && naturalSize && naturalSize.width > 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              transition: mainTransition,
              transform: mainTransform,
              willChange: "transform",
            }}
          >
            <OcrTextOverlay blocks={ocrBlocks} aspectRatio={naturalSize.height / naturalSize.width} />
          </div>
        )}
        {isMainContent && faceLocation && !drawingFace && (
          <FaceOverlay faceLocation={faceLocation} imageDimensions={imageDimensions} />
        )}
        {isMainContent && drawingFace && onFaceDrawn && onCancelDrawFace && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              transition: mainTransition,
              transform: mainTransform,
              willChange: "transform",
            }}
          >
            <FaceDrawLayer onCommit={onFaceDrawn} onCancel={onCancelDrawFace} />
          </div>
        )}
      </div>
    </div>
  );
}
