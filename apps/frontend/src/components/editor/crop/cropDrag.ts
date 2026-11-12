/**
 * The crop tool's frame as the user drags it, in full-frame pixels (engine/geometry.ts,
 * fullFrameLayout): moving it, pulling an edge or a corner, with or without an aspect lock, and
 * nudging it with the arrow keys. What comes out is turned into a recipe crop and kept inside the
 * picture by the caller (cropFromFullFrame, clampCrop).
 */
import type { EditAspect } from "@librephotos/api-client";
import {
  clampCrop,
  cropFromFullFrame,
  largestCrop,
  orientedSize,
  type PixelCrop,
  type Point,
  type Size,
} from "../engine/geometry";
import type { CropRect, GeometrySettings } from "../engine/recipe";

/** What is dragged: the whole frame, an edge or a corner (by compass point). */
export type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const CROP_HANDLES: readonly Exclude<CropHandle, "move">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** The width-to-height ratio an aspect lock asks for, on a picture of the oriented size; null when free. */
export function aspectRatio(aspect: EditAspect | null, oriented: Size): number | null {
  if (aspect === null) return null;
  if (aspect === "original") return oriented.width / oriented.height;
  const [w, h] = aspect.split(":").map(Number);
  return w && h ? w / h : null;
}

type Edges = { left: number; top: number; right: number; bottom: number };

const toEdges = (crop: PixelCrop): Edges => ({
  left: crop.x - crop.width / 2,
  top: crop.y - crop.height / 2,
  right: crop.x + crop.width / 2,
  bottom: crop.y + crop.height / 2,
});

const fromEdges = ({ left, top, right, bottom }: Edges): PixelCrop => ({
  x: (left + right) / 2,
  y: (top + bottom) / 2,
  width: right - left,
  height: bottom - top,
});

/** The edges a handle moves, and which way along each axis (-1 the low edge, 1 the high one, 0 none). */
function handleAxes(handle: Exclude<CropHandle, "move">): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  return {
    x: handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0,
    y: handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0,
  };
}

/** Keep the ratio after a resize: a corner keeps its opposite corner, an edge stays centred across. */
function lockRatio(edges: Edges, start: Edges, axes: { x: number; y: number }, ratio: number): Edges {
  let width = edges.right - edges.left;
  let height = edges.bottom - edges.top;
  if (axes.y === 0 || (axes.x !== 0 && width / ratio >= height)) height = width / ratio;
  else width = height * ratio;
  const locked = { ...edges };
  if (axes.x === -1) locked.left = edges.right - width;
  else if (axes.x === 1) locked.right = edges.left + width;
  else {
    const cx = (start.left + start.right) / 2;
    locked.left = cx - width / 2;
    locked.right = cx + width / 2;
  }
  if (axes.y === -1) locked.top = edges.bottom - height;
  else if (axes.y === 1) locked.bottom = edges.top + height;
  else {
    const cy = (start.top + start.bottom) / 2;
    locked.top = cy - height / 2;
    locked.bottom = cy + height / 2;
  }
  return locked;
}

/**
 * The frame after dragging `handle` by `delta` from `start`: never smaller than `minSize` either way,
 * never turned inside out, and of `ratio` (width / height) when the aspect is locked.
 */
export function dragCrop(
  start: PixelCrop,
  handle: CropHandle,
  delta: Point,
  ratio: number | null,
  minSize: number
): PixelCrop {
  if (handle === "move") return { ...start, x: start.x + delta.x, y: start.y + delta.y };
  const axes = handleAxes(handle);
  const from = toEdges(start);
  const edges = { ...from };
  if (axes.x === -1) edges.left = Math.min(from.right - minSize, from.left + delta.x);
  if (axes.x === 1) edges.right = Math.max(from.left + minSize, from.right + delta.x);
  if (axes.y === -1) edges.top = Math.min(from.bottom - minSize, from.top + delta.y);
  if (axes.y === 1) edges.bottom = Math.max(from.top + minSize, from.bottom + delta.y);
  return fromEdges(ratio === null ? edges : lockRatio(edges, from, axes, ratio));
}

/** The recipe crop a dragged frame stands for, kept inside the turned picture. */
export function settleCrop(drawn: PixelCrop, geometry: GeometrySettings, source: Size): CropRect {
  const oriented = orientedSize(source, geometry.orientation);
  return clampCrop(cropFromFullFrame(drawn, geometry, source), oriented, geometry.straighten);
}

/** The geometry with an aspect lock: the largest crop of that ratio, centred; free keeps the crop. */
export function withAspect(geometry: GeometrySettings, aspect: EditAspect | null, source: Size): GeometrySettings {
  const oriented = orientedSize(source, geometry.orientation);
  const ratio = aspectRatio(aspect, oriented);
  if (ratio === null) return { ...geometry, aspect };
  return { ...geometry, aspect, crop: largestCrop(oriented, geometry.straighten, ratio) };
}

/** The geometry at another straighten angle, its crop shrunk where the turned picture no longer holds it. */
export function withStraighten(geometry: GeometrySettings, degrees: number, source: Size): GeometrySettings {
  const oriented = orientedSize(source, geometry.orientation);
  const crop = geometry.crop === null ? null : clampCrop(geometry.crop, oriented, degrees);
  return { ...geometry, straighten: degrees, crop };
}

/** How far an arrow key moves the frame: a hundredth of the full frame, a tenth with Shift. */
export function nudgeDelta(key: string, shift: boolean, frame: Size): Point | null {
  const step = (length: number) => length * (shift ? 0.1 : 0.01);
  switch (key) {
    case "ArrowLeft":
      return { x: -step(frame.width), y: 0 };
    case "ArrowRight":
      return { x: step(frame.width), y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step(frame.height) };
    case "ArrowDown":
      return { x: 0, y: step(frame.height) };
    default:
      return null;
  }
}
