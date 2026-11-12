import { useGesture } from "@use-gesture/react";
import { useEffect, useRef, type RefObject } from "react";
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
  // Where a pinch began: its view and the distance between the fingers.
  const pinchStart = useRef<{ view: ViewTransform; distance: number } | null>(null);
  useEffect(() => {
    latest.current = { drawn, pixelRatio, locked, onZoom };
  });
  useEffect(() => {
    asked.current = null;
  }, [drawn]);

  const toCanvas = (clientX: number, clientY: number) => {
    const rect = stage.current?.getBoundingClientRect();
    const ratio = latest.current.pixelRatio;
    return { x: (clientX - (rect?.left ?? 0)) * ratio, y: (clientY - (rect?.top ?? 0)) * ratio };
  };
  const base = (frame: DrawnFrame) => asked.current ?? frame.view;
  const zoomTo = (view: ViewTransform) => {
    asked.current = view;
    latest.current.onZoom({ kind: "manual", view });
  };

  useGesture(
    {
      onWheel: ({ event, delta: [, dy] }) => {
        const { drawn: frame, locked: off } = latest.current;
        if (off || !frame) return;
        event.preventDefault();
        const from = base(frame);
        const scale = from.scale * Math.exp(-dy * WHEEL_ZOOM_RATE);
        zoomTo(
          zoomAround(from, scale, toCanvas(event.clientX, event.clientY), frame.canvas, frame.picture, frame.margin)
        );
      },
      onPinch: ({ origin: [ox, oy], da: [distance], first }) => {
        const { drawn: frame, locked: off } = latest.current;
        if (off || !frame) return;
        if (first || !pinchStart.current) pinchStart.current = { view: base(frame), distance };
        const start = pinchStart.current;
        const scale = start.view.scale * (distance / Math.max(1, start.distance));
        zoomTo(zoomAround(start.view, scale, toCanvas(ox, oy), frame.canvas, frame.picture, frame.margin));
      },
      onDrag: ({ delta: [dx, dy], pinching, tap }) => {
        const { drawn: frame, locked: off, pixelRatio: ratio } = latest.current;
        if (off || pinching || tap || !frame) return;
        const from = base(frame);
        if (isFitted(from, frame.canvas, frame.picture, frame.margin)) return;
        zoomTo(panBy(from, { x: dx * ratio, y: dy * ratio }, frame.canvas, frame.picture));
      },
    },
    {
      target: stage,
      eventOptions: { passive: false },
      drag: { filterTaps: true },
      pinch: { scaleBounds: { min: 0.01, max: 100 } },
    }
  );

  /** A double click on the picture: fitted and 100 % in turn, around the pointer. */
  return (event: { clientX: number; clientY: number }) => {
    const { drawn: frame, locked: off } = latest.current;
    if (off || !frame) return;
    asked.current = null;
    latest.current.onZoom(
      toggleZoom(base(frame), toCanvas(event.clientX, event.clientY), frame.canvas, frame.picture, frame.margin)
    );
  };
}
