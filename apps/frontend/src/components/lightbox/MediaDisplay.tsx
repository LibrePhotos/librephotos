import React, { useRef } from "react";
import { serverAddress } from "../../api_client/apiClient";
import { FaceOverlay } from "./FaceOverlay";
import type { FaceLocationType } from "./lightbox.types";
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
}: MediaDisplayProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);

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
  const imageUrl =
    isGif() && isMainContent
      ? `${serverAddress}/media/photos/${mediaHash}`
      : `${serverAddress}/media/thumbnails_big/${mediaHash}`;

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
          style={{
            transition: isMainContent ? "transform 0.15s ease-out" : "none",
            transform: isMainContent ? `translate(${offset.x}px, ${offset.y}px) scale(${scale})` : "none",
            maxHeight: "82vh",
            maxWidth: "100%",
            borderRadius: 8,
            opacity: isMainContent ? 1 : 0.9,
            willChange: isMainContent ? "transform" : "auto",
            WebkitTapHighlightColor: "transparent",
            boxShadow: isMainContent ? "0 4px 16px rgba(0,0,0,0.1)" : "none",
          }}
        />
        {isMainContent && faceLocation && <FaceOverlay faceLocation={faceLocation} imageDimensions={imageDimensions} />}
      </div>
    </div>
  );
}
