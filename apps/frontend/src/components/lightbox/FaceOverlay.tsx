import { Box } from "@mantine/core";
import React from "react";
import type { FaceOverlayProps } from "./lightbox.types";

export function FaceOverlay({ faceLocation, imageDimensions }: FaceOverlayProps) {
  const getRelativePosition = (position: NonNullable<typeof faceLocation>) => {
    if (!position || !imageDimensions.width || !imageDimensions.height) return {};

    const top = (position.top / imageDimensions.height) * 100;
    const left = (position.left / imageDimensions.width) * 100;
    const width = ((position.right - position.left) / imageDimensions.width) * 100;
    const height = ((position.bottom - position.top) / imageDimensions.height) * 100;

    return { top: `${top}%`, left: `${left}%`, width: `${width}%`, height: `${height}%` };
  };

  if (!faceLocation) return null;

  return (
    <Box
      style={theme => ({
        position: "absolute",
        border: `2px solid ${theme.colors.gray[4]}`,
        borderRadius: theme.radius.lg,
        ...getRelativePosition(faceLocation),
        boxShadow: theme.shadows.lg,
        pointerEvents: "none", // Ensures this doesn't interfere with gestures
      })}
    />
  );
}
