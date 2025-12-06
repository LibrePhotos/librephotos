import React, { useRef, useState } from "react";
import ReactPlayer from "react-player";
import { Alert, Text } from "@mantine/core";

import { serverAddress } from "../../api_client/apiClient";
import { FaceOverlay } from "./FaceOverlay";
import type { FaceLocationType } from "./lightbox.types";

export type MediaDisplayProps = {
  id: string | undefined;
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
  // Hooks must be called unconditionally at the top of the component
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [videoError, setVideoError] = useState(false);

  if (!id) return null;

  const imageDimensions = { 
    width: imgRef.current?.naturalWidth ?? 1080,
    height: imgRef.current?.naturalHeight ?? 810
  };

  // Helper function to check if the photo is a GIF
  const isGif = () => {
    if (!photoDetails?.image_path || !Array.isArray(photoDetails.image_path)) {
      return false;
    }
    return photoDetails.image_path.some((path: string) => 
      path.toLowerCase().endsWith('.gif')
    );
  };

  // Determine the media type for the current slide
  const currentType = isMainContent ? type : "photo"; // Assuming previews are always photos

  if (currentType === "video") {
    if (videoError) {
      return (
        <Alert color="red" title="Video Not Found" style={{ width: "100%", height: fullHeight ? "100%" : "82vh" }}>
          <Text>The video file could not be found or is no longer available.</Text>
        </Alert>
      );
    }
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
        onError={() => setVideoError(true)}
        onEnded={isMainContent ? onEnded : undefined}
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
        onEnded={isMainContent ? onEnded : undefined}
      />
    );
  }

  // For GIFs, use the original photo endpoint to get the animated file
  // For regular photos, use the big thumbnail
  const imageUrl = isGif() && isMainContent 
    ? `${serverAddress}/media/photos/${id}` 
    : `${serverAddress}/media/thumbnails_big/${id}`;

  return (
    <div   {...(isMainContent && bind ? bind() : {})} style={{ 
      position: "relative",  
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: fullHeight ? "100%" : "82vh",
      borderRadius: "8px",
    }}>
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
            WebkitTapHighlightColor: "transparent", // Remove tap highlight on mobile
            boxShadow: isMainContent ? "0 4px 16px rgba(0,0,0,0.1)" : "none",
          }}
        />
      {isMainContent && faceLocation && (
        <FaceOverlay faceLocation={faceLocation} imageDimensions={imageDimensions} />
      )}
      </div>
      </div>
  );
}