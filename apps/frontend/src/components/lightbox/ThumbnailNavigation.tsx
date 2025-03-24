import { Box, Group } from "@mantine/core";
import React from "react";

import { serverAddress } from "../../api_client/apiClient";
import type { ThumbnailNavigationProps } from "./lightbox.types";

export function ThumbnailNavigation({
  prevSrc,
  mainSrc,
  nextSrc,
  onMovePrevRequest,
  onMoveNextRequest,
}: ThumbnailNavigationProps) {
  return (
    <div
      style={{
        height: "80px",
        marginTop: "12px",
        overflow: "visible",
        position: "absolute",
        bottom: "16px",
        left: "0",
        right: "0",
        zIndex: 100,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
        background: "rgba(0,0,0,0.2)",
        padding: "8px 0",
        borderRadius: "8px",
        boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
        margin: "0 auto",
        width: "fit-content",
        minWidth: "240px",
        maxWidth: "90%",
      }}
    >
      <Group justify="center" align="center" style={{ height: "100%" }}>
        {prevSrc && (
          <PreviousThumbnail
            src={prevSrc}
            onClick={onMovePrevRequest}
          />
        )}

        <CurrentThumbnail src={mainSrc} />

        {nextSrc && (
          <NextThumbnail
            src={nextSrc}
            onClick={onMoveNextRequest}
          />
        )}
      </Group>
    </div>
  );
}

type ThumbnailProps = {
  src: string;
  onClick?: () => void;
};

function PreviousThumbnail({ src, onClick }: ThumbnailProps) {
  return (
    <Box
      style={{
        height: "64px",
        width: "64px",
        cursor: "pointer",
        border: "2px solid rgba(255,255,255,0.6)",
        borderRadius: "8px",
        overflow: "hidden",
        opacity: 0.85,
        transition: "all 0.2s ease",
        backgroundColor: "rgba(0,0,0,0.3)",
        transform: "scale(0.85) translateX(10px)",
        boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
      }}
      onClick={onClick}
      onMouseOver={e => {
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.transform = "scale(0.9) translateX(10px)";
        e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.4)";
      }}
      onMouseOut={e => {
        e.currentTarget.style.opacity = "0.85";
        e.currentTarget.style.transform = "scale(0.85) translateX(10px)";
        e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.3)";
      }}
    >
      <img
        src={`${serverAddress}/media/square_thumbnails/${src}`}
        alt="Previous"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          pointerEvents: "none",
        }}
        loading="eager"
      />
    </Box>
  );
}

function CurrentThumbnail({ src }: { src: string }) {
  return (
    <Box
      style={{
        height: "72px",
        width: "72px",
        border: "3px solid #fff",
        borderRadius: "8px",
        overflow: "hidden",
        marginLeft: "8px",
        marginRight: "8px",
        boxShadow: "0 0 12px rgba(255,255,255,0.3), 0 4px 8px rgba(0,0,0,0.5)",
        backgroundColor: "rgba(0,0,0,0.3)",
        zIndex: 1,
      }}
    >
      <img
        src={`${serverAddress}/media/square_thumbnails/${src}`}
        alt="Current"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          pointerEvents: "none",
        }}
        loading="eager"
      />
    </Box>
  );
}

function NextThumbnail({ src, onClick }: ThumbnailProps) {
  return (
    <Box
      style={{
        height: "64px",
        width: "64px",
        cursor: "pointer",
        border: "2px solid rgba(255,255,255,0.6)",
        borderRadius: "8px",
        overflow: "hidden",
        opacity: 0.85,
        transition: "all 0.2s ease",
        backgroundColor: "rgba(0,0,0,0.3)",
        transform: "scale(0.85) translateX(-10px)",
        boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
      }}
      onClick={onClick}
      onMouseOver={e => {
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.transform = "scale(0.9) translateX(-10px)";
        e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.4)";
      }}
      onMouseOut={e => {
        e.currentTarget.style.opacity = "0.85";
        e.currentTarget.style.transform = "scale(0.85) translateX(-10px)";
        e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.3)";
      }}
    >
      <img
        src={`${serverAddress}/media/square_thumbnails/${src}`}
        alt="Next"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          pointerEvents: "none",
        }}
        loading="eager"
      />
    </Box>
  );
}