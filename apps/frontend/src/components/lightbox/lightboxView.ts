import type { GesturePoint } from "../../hooks/viewerGestures";

export type LightboxView = Readonly<{ scale: number; x: number; y: number }>;
export type BoxSize = Readonly<{ width: number; height: number }>;

export const UNZOOMED: LightboxView = { scale: 1, x: 0, y: 0 };
export const MAX_SCALE = 4;
export const TOGGLE_SCALE = 2;
export const MIN_KEPT_SCALE = 1.1;
const WHEEL_ZOOM_RATE = 0.0015;
const PINCH_WHEEL_ZOOM_RATE = 0.01;

export const isMagnifiedView = (view: LightboxView) => view.scale > 1;

function clampAxis(offset: number, box: number, content: number, scale: number): number {
  const slack = Math.max(0, (content * scale - box) / 2);
  return Math.min(slack, Math.max(-slack, offset));
}

export function clampView(view: LightboxView, box: BoxSize, content: BoxSize): LightboxView {
  const scale = Math.min(MAX_SCALE, Math.max(1, view.scale));
  return {
    scale,
    x: clampAxis(view.x, box.width, content.width, scale),
    y: clampAxis(view.y, box.height, content.height, scale),
  };
}

export function zoomAround(
  view: LightboxView,
  scale: number,
  anchor: GesturePoint,
  box: BoxSize,
  content: BoxSize
): LightboxView {
  const next = Math.min(MAX_SCALE, Math.max(1, scale));
  const ratio = next / view.scale;
  return clampView(
    { scale: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio },
    box,
    content
  );
}

export function pinchView(
  start: LightboxView,
  scale: number,
  startAnchor: GesturePoint,
  anchor: GesturePoint,
  box: BoxSize,
  content: BoxSize
): LightboxView {
  const next = Math.min(MAX_SCALE, Math.max(1, start.scale * scale));
  const ratio = next / start.scale;
  return clampView(
    { scale: next, x: anchor.x - (startAnchor.x - start.x) * ratio, y: anchor.y - (startAnchor.y - start.y) * ratio },
    box,
    content
  );
}

export function panView(view: LightboxView, delta: GesturePoint, box: BoxSize, content: BoxSize): LightboxView {
  return clampView({ ...view, x: view.x + delta.x, y: view.y + delta.y }, box, content);
}

export function wheelScale(view: LightboxView, deltaY: number, pinch: boolean): number {
  return view.scale * Math.exp(-deltaY * (pinch ? PINCH_WHEEL_ZOOM_RATE : WHEEL_ZOOM_RATE));
}

export function toggledView(view: LightboxView, anchor: GesturePoint, box: BoxSize, content: BoxSize): LightboxView {
  return isMagnifiedView(view) ? UNZOOMED : zoomAround(view, TOGGLE_SCALE, anchor, box, content);
}

const SWIPE_DISTANCE_SHARE = 0.25;
const SWIPE_VELOCITY_PX_PER_MS = 0.5;
export const EDGE_RESISTANCE = 0.3;

export function swipeTarget(movement: number, velocity: number, width: number): -1 | 0 | 1 {
  const flung = Math.abs(velocity) >= SWIPE_VELOCITY_PX_PER_MS && Math.sign(velocity) === Math.sign(movement);
  if (!flung && Math.abs(movement) < width * SWIPE_DISTANCE_SHARE) return 0;
  return movement < 0 ? 1 : -1;
}
