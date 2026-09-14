import { Box } from "@mantine/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedFaceBox } from "../../api_client/faces/hooks/useAddFaceMutation";

type Props = {
  /** Receives the drawn box with each side as a fraction of the image. */
  onCommit: (box: NormalizedFaceBox) => void;
  onCancel: () => void;
};

type Point = { x: number; y: number };

/**
 * A drag smaller than this fraction of the image is a stray click, not a face.
 * The backend rejects boxes under a pixel floor as well; this only avoids
 * bothering it (and the user) with an obvious miss.
 */
const MIN_SIDE_FRACTION = 0.02;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function boxFromPoints(start: Point, end: Point): NormalizedFaceBox {
  return {
    top: clamp01(Math.min(start.y, end.y)),
    bottom: clamp01(Math.max(start.y, end.y)),
    left: clamp01(Math.min(start.x, end.x)),
    right: clamp01(Math.max(start.x, end.x)),
  };
}

export function isBoxBigEnough(box: NormalizedFaceBox): boolean {
  return box.right - box.left >= MIN_SIDE_FRACTION && box.bottom - box.top >= MIN_SIDE_FRACTION;
}

/**
 * Lets the user drag a rectangle over the photo to mark a face the detector
 * missed.
 *
 * The layer is a sibling of the image inside the wrapper that matches the image
 * exactly, and it carries the same transform, so a fraction of the layer is the
 * same fraction of the image. Reading the pointer against the layer's own
 * bounding rect therefore stays correct while the photo is zoomed or panned --
 * the rect is the box as it ends up on screen. Rotation is the exception (the
 * rect becomes the bounding box of a rotated rectangle), which is why the
 * caller only mounts this while the photo is unrotated.
 */
export function FaceDrawLayer({ onCommit, onCancel }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const pointOf = useCallback((event: React.PointerEvent): Point | null => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }, []);

  // The photo sits inside a carousel and a drag-to-pan handler, both of which
  // would rather treat this drag as a swipe.
  const swallow = (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    swallow(event);
    const point = pointOf(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setStart(point);
    setCurrent(point);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!start) return;
    swallow(event);
    const point = pointOf(event);
    if (point) setCurrent(point);
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!start) return;
    swallow(event);
    const end = pointOf(event) ?? current;
    setStart(null);
    setCurrent(null);
    if (!end) return;
    const box = boxFromPoints(start, end);
    if (isBoxBigEnough(box)) {
      onCommit(box);
    }
  };

  const rubberBand = start && current ? boxFromPoints(start, current) : null;

  return (
    <Box
      ref={layerRef}
      data-testid="face-draw-layer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: "absolute",
        inset: 0,
        cursor: "crosshair",
        touchAction: "none",
        borderRadius: 8,
        // Dim the photo a little so it is obvious the click does something else
        // than usual right now.
        backgroundColor: "rgba(0, 0, 0, 0.25)",
      }}
    >
      {rubberBand && (
        <Box
          style={theme => ({
            position: "absolute",
            top: `${rubberBand.top * 100}%`,
            left: `${rubberBand.left * 100}%`,
            width: `${(rubberBand.right - rubberBand.left) * 100}%`,
            height: `${(rubberBand.bottom - rubberBand.top) * 100}%`,
            border: `2px solid ${theme.colors.blue[4]}`,
            borderRadius: theme.radius.sm,
            backgroundColor: "rgba(255, 255, 255, 0.12)",
            pointerEvents: "none",
          })}
        />
      )}
    </Box>
  );
}
