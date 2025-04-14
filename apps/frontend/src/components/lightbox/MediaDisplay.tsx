import { Box } from "@mantine/core";
import React from "react";
import ReactPlayer from "react-player";

import { serverAddress } from "../../api_client/apiClient";
import { FaceOverlay } from "./FaceOverlay";
import type { MediaDisplayProps } from "./lightbox.types";

export function MediaDisplay({
  id,
  isMainContent = false,
  type,
  bind,
  imageDimensions,
  setImageDimensions,
  faceLocation,
  toggleZoom,
  scale = 1,
  offset = { x: 0, y: 0 },
  handleDragStart,
  fullHeight = false,
  playing = false,
}: MediaDisplayProps) {
  if (!id) return null;

  // Determine the media type for the current slide
  const currentType = isMainContent ? type : "photo"; // Assuming previews are always photos

  if (currentType === "video") {
    return (
      <ReactPlayer
        url={`${serverAddress}/media/video/${id}`}
        width="100%"
        height={fullHeight ? "100%" : "82vh"}
        controls={isMainContent}
        playing={isMainContent && playing}
        progressInterval={100}
        style={{
          objectFit: "contain",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      />
    );
  }

  if (currentType === "embedded") {
    return (
      <ReactPlayer
        url={`${serverAddress}/media/embedded_media/${id}`}
        width="100%"
        height={fullHeight ? "100%" : "82vh"}
        controls={isMainContent}
        playing={isMainContent && playing}
        progressInterval={100}
        style={{
          objectFit: "contain",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: "relative",
        height: fullHeight ? "100%" : "82vh",
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      <div
        {...(isMainContent && bind ? bind() : {})}
        style={{
          position: "relative",
          height: "100%",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px",
        }}
      >
        <img
          src={`${serverAddress}/media/thumbnails_big/${id}`}
          alt={isMainContent ? "Main Content" : "Preview"}
          loading="eager"
          onLoad={event => {
            if (isMainContent) {
              const { naturalWidth, naturalHeight } = event.target as HTMLImageElement;
              setImageDimensions({ width: naturalWidth, height: naturalHeight });
            }
          }}
          onDragStart={handleDragStart}
          onDoubleClick={isMainContent && toggleZoom ? toggleZoom : undefined}
          style={{
            transition: isMainContent ? "transform 0.15s ease-out" : "none",
            transform: isMainContent ? `translate(${offset.x}px, ${offset.y}px) scale(${scale})` : "none",
            objectFit: "contain",
            height: "100%",
            width: "auto",
            maxWidth: "100%",
            display: "block",
            margin: "auto",
            borderRadius: 8,
            opacity: isMainContent ? 1 : 0.9,
            willChange: isMainContent ? "transform" : "auto", // For smoother animations
            backfaceVisibility: "hidden", // Prevents flickering in some browsers
            WebkitBackfaceVisibility: "hidden",
            WebkitTapHighlightColor: "transparent", // Remove tap highlight on mobile
            boxShadow: isMainContent ? "0 4px 16px rgba(0,0,0,0.1)" : "none",
            imageRendering: "auto", // Use auto for best quality rendering
          }}
        />
      </div>
      {isMainContent && faceLocation && (
        <FaceOverlay faceLocation={faceLocation} imageDimensions={imageDimensions} />
      )}
    </div>
  );
}