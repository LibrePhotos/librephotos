import { useEffect, useRef, type RefObject } from "react";
import { useViewerGestures } from "../../../hooks/useViewerGestures";
import type { GesturePoint } from "../../../hooks/viewerGestures";
import type { ViewTransform } from "../engine/geometry";
import type { DrawnFrame } from "./usePreview";
import { isFitted, panBy, toggleZoom, zoomAround, type ZoomState } from "./viewMath";

/** How fast the wheel zooms: a notch (deltaY 100) is about 16 %. */
const WHEEL_ZOOM_RATE = 0.0015;

type Args = Readonly<{
  stage: RefObject<HTMLDivElement | null>;
  /** The last frame drawn: the view the gestures start from. */
  drawn: DrawnFrame | null;
  /** Canvas pixels per CSS pixel. */
  pixelRatio: number;
  /** Zoom and pan are off (the crop tool keeps the picture fitted). */
  locked: boolean;
  onZoom: (zoom: ZoomState) => void;
}>;

/**
 * Zooming and panning the canvas: the wheel and a pinch zoom around the pointer, a drag pans a
 * zoomed picture, a double click goes between fitted and 100 %. Positions are taken in canvas pixels.
 */
export function useStageGestures({ stage, drawn, pixelRatio, locked, onZoom }: Args) {
  const latest = useRef({ drawn, pixelRatio, locked, onZoom });
  // The view asked for and not drawn yet: wheel events come faster than frames, and each one
  // zooms on from the last, not from the frame on screen.
  const asked = useRef<ViewTransform | null>(null);
  const pinchStart = useRef<ViewTransform | null>(null);
  useEffect(() => {
    latest.current = { drawn, pixelRatio, locked, onZoom };
  });
  useEffect(() => {
    asked.current = null;
  }, [drawn]);

  const toCanvas = ({ x, y }: GesturePoint) => {
    const rect = stage.current?.getBoundingClientRect();
    const ratio = latest.current.pixelRatio;
    return { x: (x - (rect?.left ?? 0)) * ratio, y: (y - (rect?.top ?? 0)) * ratio };
  };
  const base = (frame: DrawnFrame) => asked.current ?? frame.view;
  const zoomTo = (view: ViewTransform) => {
    asked.current = view;
    latest.current.onZoom({ kind: "manual", view });
  };
  const active = () => (latest.current.locked ? null : latest.current.drawn);

  useViewerGestures(stage, {
    onWheel: ({ point, deltaY }) => {
      const frame = active();
      if (!frame) return false;
      const from = base(frame);
      const scale = from.scale * Math.exp(-deltaY * WHEEL_ZOOM_RATE);
      zoomTo(zoomAround(from, scale, toCanvas(point), frame.canvas, frame.picture, frame.margin));
      return true;
    },
    onPinch: ({ first, scale, origin }) => {
      const frame = active();
      if (!frame) return;
      if (first || !pinchStart.current) pinchStart.current = base(frame);
      const start = pinchStart.current;
      zoomTo(zoomAround(start, start.scale * scale, toCanvas(origin), frame.canvas, frame.picture, frame.margin));
    },
    onPinchEnd: () => {
      pinchStart.current = null;
    },
    onDrag: ({ delta }) => {
      const frame = active();
      if (!frame) return;
      const ratio = latest.current.pixelRatio;
      const from = base(frame);
      if (isFitted(from, frame.canvas, frame.picture, frame.margin)) return;
      zoomTo(panBy(from, { x: delta.x * ratio, y: delta.y * ratio }, frame.canvas, frame.picture));
    },
  });

  /** A double click on the picture: fitted and 100 % in turn, around the pointer. */
  return (event: { clientX: number; clientY: number }) => {
    const frame = active();
    if (!frame) return;
    asked.current = null;
    latest.current.onZoom(
      toggleZoom(
        base(frame),
        toCanvas({ x: event.clientX, y: event.clientY }),
        frame.canvas,
        frame.picture,
        frame.margin
      )
    );
  };
}
