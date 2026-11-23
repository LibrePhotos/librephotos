/**
 * Zoom and pan of the editor's canvas, as plain maths on the renderer's ViewTransform (picture
 * pixel `p` is drawn at `x + p scale`, in canvas pixels). 100 % is one working pixel per canvas
 * pixel; the view never zooms out past the fitted picture nor in past MAX_ZOOM, and a picture larger
 * than the canvas cannot be dragged away from its edges.
 */
import { fitView, type Point, type Size, type ViewTransform } from "../engine/geometry";

/** The closest zoom: four canvas pixels per working pixel. */
export const MAX_ZOOM = 4;

/** Fitted (follows the canvas size), or a zoom the user chose. */
export type ZoomState = Readonly<{ kind: "fit" }> | Readonly<{ kind: "manual"; view: ViewTransform }>;

export const FIT: ZoomState = { kind: "fit" };

/** The smallest scale: the fitted picture's, or 100 % for a picture smaller than the canvas. */
function minScale(canvas: Size, picture: Size, margin: number): number {
  return Math.min(fitView(canvas, picture, margin).scale, 1);
}

/** Keep the picture over the canvas: centred along an axis where it is smaller, edge to edge otherwise. */
export function clampPan(view: ViewTransform, canvas: Size, picture: Size): ViewTransform {
  const axis = (offset: number, canvasLength: number, pictureLength: number) => {
    const drawn = pictureLength * view.scale;
    if (drawn <= canvasLength) return (canvasLength - drawn) / 2;
    return Math.min(0, Math.max(canvasLength - drawn, offset));
  };
  return {
    scale: view.scale,
    x: axis(view.x, canvas.width, picture.width),
    y: axis(view.y, canvas.height, picture.height),
  };
}

/** The view a zoom state gives on this canvas. */
export function resolveView(state: ZoomState, canvas: Size, picture: Size, margin = 0): ViewTransform {
  return state.kind === "fit" ? fitView(canvas, picture, margin) : clampPan(state.view, canvas, picture);
}

/** Zoom to `scale` keeping the picture point under `anchor` (canvas pixels) where it is. */
export function zoomAround(
  view: ViewTransform,
  scale: number,
  anchor: Point,
  canvas: Size,
  picture: Size,
  margin = 0
): ViewTransform {
  const next = Math.min(MAX_ZOOM, Math.max(minScale(canvas, picture, margin), scale));
  const ratio = next / view.scale;
  return clampPan(
    { scale: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio },
    canvas,
    picture
  );
}

/** Move a zoomed picture by a drag of `delta` canvas pixels. */
export function panBy(view: ViewTransform, delta: Point, canvas: Size, picture: Size): ViewTransform {
  return clampPan({ ...view, x: view.x + delta.x, y: view.y + delta.y }, canvas, picture);
}

/** Whether a view is (about) the fitted one: zooming has not started or went all the way back. */
export function isFitted(view: ViewTransform, canvas: Size, picture: Size, margin = 0): boolean {
  return Math.abs(view.scale - fitView(canvas, picture, margin).scale) < 1e-6;
}

/**
 * A double click: from the fitted view to 100 % around the pointer (or MAX_ZOOM's worth closer for a
 * tiny picture already shown at 100 %), from any zoom back to fitted.
 */
export function toggleZoom(view: ViewTransform, anchor: Point, canvas: Size, picture: Size, margin = 0): ZoomState {
  if (!isFitted(view, canvas, picture, margin)) return FIT;
  const target = view.scale < 1 ? 1 : Math.min(MAX_ZOOM, view.scale * 2);
  return { kind: "manual", view: zoomAround(view, target, anchor, canvas, picture, margin) };
}

/** The zoom readout: percent of the working picture, rounded. */
export function zoomPercent(view: ViewTransform): number {
  return Math.round(view.scale * 100);
}
