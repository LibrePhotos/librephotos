import React, { useEffect, useRef, useState } from "react";
import { serverAddress } from "../../api_client/apiClient";
import type { PhotoOcrBlock } from "../../api_client/photos/types";
import { FaceOverlay } from "./FaceOverlay";
import type { FaceLocationType } from "./lightbox.types";
import { OcrTextOverlay } from "./OcrTextOverlay";
import { VideoPlayer } from "./VideoPlayer";

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
  onEnded?: () => void;
  rotationAngle?: number;
  imageCacheKey?: number;
  suppressRotationTransition?: boolean;
  onImageLoad?: () => void;
  ocrBlocks?: PhotoOcrBlock[];
  showOcrText?: boolean;
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
  onEnded,
  rotationAngle = 0,
  imageCacheKey = 0,
  suppressRotationTransition = false,
  onImageLoad,
  ocrBlocks,
  showOcrText = false,
}: MediaDisplayProps) {
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
  const videoContainerHeight = fullHeight ? "100%" : "82vh";
  const thumbnailUrl = `${serverAddress}/media/thumbnails_big/${mediaHash}`;

  if (currentType === "video" || currentType === "embedded") {
    // Backend strips extension via fname.split(".")[0], so .mp4 suffix is safe
    // and helps the browser identify the content type for native playback.
    // The backend serves either the original file (via X-Accel-Redirect / FileResponse)
    // or a transcoded stream (StreamingHttpResponse) depending on user settings.
    const videoUrl =
      currentType === "video"
        ? `${serverAddress}/media/photos/${mediaHash}.mp4`
        : `${serverAddress}/media/embedded_media/${mediaHash}`;

    return (
      <VideoPlayer
        url={videoUrl}
        posterUrl={thumbnailUrl}
        height={videoContainerHeight}
        controls={isMainContent}
        playing={isMainContent && playing}
        onEnded={isMainContent ? onEnded : undefined}
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
        height: fullHeight ? "100%" : "82vh",
        borderRadius: "8px",
      }}
    >
      <div style={{ position: "relative" }}>
        <img
          ref={imgRef}
          src={imageUrl}
          alt={isMainContent ? "Main Content" : "Preview"}
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
        {isMainContent && faceLocation && <FaceOverlay faceLocation={faceLocation} imageDimensions={imageDimensions} />}
      </div>
    </div>
  );
}
