/**
 * Stage 1 of the pipeline (apps/docs/docs/development/photo-editing.md): orientation, flips,
 * straighten and crop, as plain functions the renderer and the crop tool share.
 *
 * Frames: the source (`W0 x H0`, upright), the oriented picture (`W x H`, after the quarter turns
 * and the flips; the crop is in its units) and the output (`Wout x Hout`, the cropped picture,
 * axis-aligned with the crop). The full frame is the output the crop tool shows: the whole
 * oriented picture turned by the straighten angle, in its bounding box.
 */
import type { CropRect, GeometrySettings } from "./recipe";

export type Size = Readonly<{ width: number; height: number }>;
export type Point = Readonly<{ x: number; y: number }>;
/** A 2D affine map `(u, v) -> (a u + b v + c, d u + e v + f)`. */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

function quarterTurns(orientation: number): 0 | 1 | 2 | 3 {
  const k = ((Math.round(orientation / 90) % 4) + 4) % 4;
  return k === 1 ? 1 : k === 2 ? 2 : k === 3 ? 3 : 0;
}
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** The oriented size: width and height swap for a quarter or three-quarter turn. */
export function orientedSize(source: Size, orientation: number): Size {
  return quarterTurns(orientation) % 2 === 1 ? { width: source.height, height: source.width } : source;
}

/** The scale `s` of the largest rectangle of the picture's own aspect that fits it at `degrees`. */
export function defaultCropScale(oriented: Size, degrees: number): number {
  const { width: W, height: H } = oriented;
  const c = Math.abs(Math.cos(radians(degrees)));
  const s = Math.abs(Math.sin(radians(degrees)));
  return Math.min(W / (W * c + H * s), H / (W * s + H * c));
}

/** The crop a recipe renders: its own, or the default one (centred, scale `s`) when it has none. */
function effectiveCrop(geometry: GeometrySettings, oriented: Size): CropRect {
  if (geometry.crop !== null) return geometry.crop;
  const s = defaultCropScale(oriented, geometry.straighten);
  return { cx: 0.5, cy: 0.5, w: s, h: s };
}

/** The size of the whole oriented picture turned by `degrees`: its bounding box. */
function fullFrameSize(oriented: Size, degrees: number): Size {
  const c = Math.abs(Math.cos(radians(degrees)));
  const s = Math.abs(Math.sin(radians(degrees)));
  return {
    width: oriented.width * c + oriented.height * s,
    height: oriented.width * s + oriented.height * c,
  };
}

/** The rectangle the output shows, in oriented units: the crop, or the full frame (centred, may exceed 1). */
function framedRect(geometry: GeometrySettings, oriented: Size, fullFrame: boolean): CropRect {
  if (!fullFrame) return effectiveCrop(geometry, oriented);
  const frame = fullFrameSize(oriented, geometry.straighten);
  return { cx: 0.5, cy: 0.5, w: frame.width / oriented.width, h: frame.height / oriented.height };
}

/** The output size in pixels of a source of `source` pixels: `max(1, round(w W))` by `max(1, round(h H))`. */
export function outputSize(geometry: GeometrySettings, source: Size, fullFrame = false): Size {
  const oriented = orientedSize(source, geometry.orientation);
  const rect = framedRect(geometry, oriented, fullFrame);
  return {
    width: Math.max(1, Math.round(rect.w * oriented.width)),
    height: Math.max(1, Math.round(rect.h * oriented.height)),
  };
}

/** A size scaled down (never up) so its long edge is at most `maxEdge`, keeping its aspect. */
export function capSize(size: Size, maxEdge: number): Size {
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Where an output position reads the source, in source pixels (pixel centres at half integers):
 * the doc's formula with `(i + 0.5) / Wout = u` and `(j + 0.5) / Hout = v`.
 */
export function outputToSource(
  geometry: GeometrySettings,
  source: Size,
  u: number,
  v: number,
  fullFrame = false
): Point {
  const oriented = orientedSize(source, geometry.orientation);
  const { width: W, height: H } = oriented;
  const rect = framedRect(geometry, oriented, fullFrame);
  const a = radians(geometry.straighten);
  const dx = (u - 0.5) * rect.w * W;
  const dy = (v - 0.5) * rect.h * H;
  let x = rect.cx * W + dx * Math.cos(a) + dy * Math.sin(a);
  let y = rect.cy * H - dx * Math.sin(a) + dy * Math.cos(a);
  if (geometry.flip_h) x = W - x;
  if (geometry.flip_v) y = H - y;
  const { width: W0, height: H0 } = source;
  switch (quarterTurns(geometry.orientation)) {
    case 0:
      return { x, y };
    case 1:
      return { x: y, y: H0 - x };
    case 2:
      return { x: W0 - x, y: H0 - y };
    case 3:
      return { x: W0 - y, y: x };
  }
}

/**
 * The output-to-source map as an affine matrix on normalised positions: output `(u, v)` in 0 to 1
 * to source `(xs / W0, ys / H0)`. Every step of stage 1 is affine, so three points define it.
 */
export function sourceTransform(geometry: GeometrySettings, source: Size, fullFrame = false): Affine {
  const at = (u: number, v: number) => {
    const p = outputToSource(geometry, source, u, v, fullFrame);
    return { x: p.x / source.width, y: p.y / source.height };
  };
  const o = at(0, 0);
  const ou = at(1, 0);
  const ov = at(0, 1);
  return [ou.x - o.x, ov.x - o.x, o.x, ou.y - o.y, ov.y - o.y, o.y];
}

/** The affine map as a GLSL `mat3` (column-major), for `vec3(u, v, 1)`. */
export function affineToMat3(m: Affine): Float32Array {
  const [a, b, c, d, e, f] = m;
  return new Float32Array([a, d, 0, b, e, 0, c, f, 1]);
}

/** Half the extent of a `cw x ch` rectangle turned by `degrees`, along x and y. */
function rotatedHalfExtent(cw: number, ch: number, degrees: number): Point {
  const c = Math.abs(Math.cos(radians(degrees)));
  const s = Math.abs(Math.sin(radians(degrees)));
  return { x: (cw * c + ch * s) / 2, y: (cw * s + ch * c) / 2 };
}

/**
 * The largest crop of aspect `ratio` (width / height, in pixels) that fits the oriented picture at
 * `degrees`, centred.
 */
export function largestCrop(oriented: Size, degrees: number, ratio: number): CropRect {
  const { width: W, height: H } = oriented;
  const c = Math.abs(Math.cos(radians(degrees)));
  const s = Math.abs(Math.sin(radians(degrees)));
  const cw = Math.min(W / (c + s / ratio), H / (s + c / ratio));
  return { cx: 0.5, cy: 0.5, w: Math.min(1, cw / W), h: Math.min(1, cw / ratio / H) };
}

/**
 * A crop moved, and shrunk around its centre keeping its aspect when it is too large, so its
 * corners turned by `degrees` stay inside the oriented picture. It keeps at least one pixel each
 * way (the recipe takes no empty crop).
 */
export function clampCrop(crop: CropRect, oriented: Size, degrees: number): CropRect {
  const { width: W, height: H } = oriented;
  let cw = Math.max(crop.w * W, Math.min(1, W));
  let ch = Math.max(crop.h * H, Math.min(1, H));
  const half = rotatedHalfExtent(cw, ch, degrees);
  const shrink = Math.min(1, W / (2 * half.x), H / (2 * half.y));
  cw *= shrink;
  ch *= shrink;
  const fitted = rotatedHalfExtent(cw, ch, degrees);
  const cx = Math.min(W - fitted.x, Math.max(fitted.x, crop.cx * W));
  const cy = Math.min(H - fitted.y, Math.max(fitted.y, crop.cy * H));
  const unit = (x: number) => Math.min(1, Math.max(0, x));
  return { cx: unit(cx / W), cy: unit(cy / H), w: unit(cw / W), h: unit(ch / H) };
}

/** A crop in oriented pixels: its centre and size. */
export type PixelCrop = Readonly<{ x: number; y: number; width: number; height: number }>;

/** A recipe crop in oriented pixels. */
export function cropToPixels(crop: CropRect, oriented: Size): PixelCrop {
  return {
    x: crop.cx * oriented.width,
    y: crop.cy * oriented.height,
    width: crop.w * oriented.width,
    height: crop.h * oriented.height,
  };
}

/** A crop in oriented pixels as a recipe crop. */
export function pixelsToCrop(crop: PixelCrop, oriented: Size): CropRect {
  return {
    cx: crop.x / oriented.width,
    cy: crop.y / oriented.height,
    w: crop.width / oriented.width,
    h: crop.height / oriented.height,
  };
}

/**
 * The full frame the crop tool draws on, in full-frame pixels of a source of `source` pixels: its
 * size, the crop (axis-aligned there; centre and size), and the picture's four corners.
 */
export type FullFrameLayout = Readonly<{ size: Size; crop: PixelCrop; corners: readonly Point[] }>;

/** Turn an offset from the oriented picture's centre into the full frame's axes. */
function toFrame(offset: Point, degrees: number): Point {
  const a = radians(degrees);
  return {
    x: offset.x * Math.cos(a) - offset.y * Math.sin(a),
    y: offset.x * Math.sin(a) + offset.y * Math.cos(a),
  };
}

export function fullFrameLayout(geometry: GeometrySettings, source: Size): FullFrameLayout {
  const oriented = orientedSize(source, geometry.orientation);
  const { width: W, height: H } = oriented;
  const size = fullFrameSize(oriented, geometry.straighten);
  const place = (x: number, y: number) => {
    const p = toFrame({ x: x - W / 2, y: y - H / 2 }, geometry.straighten);
    return { x: p.x + size.width / 2, y: p.y + size.height / 2 };
  };
  const crop = cropToPixels(effectiveCrop(geometry, oriented), oriented);
  const centre = place(crop.x, crop.y);
  return {
    size,
    crop: { ...crop, x: centre.x, y: centre.y },
    corners: [place(0, 0), place(W, 0), place(W, H), place(0, H)],
  };
}

/**
 * A crop the crop tool drew in the full frame (centre and size in full-frame pixels) as a recipe
 * crop, not yet clamped (see clampCrop).
 */
export function cropFromFullFrame(drawn: PixelCrop, geometry: GeometrySettings, source: Size): CropRect {
  const oriented = orientedSize(source, geometry.orientation);
  const size = fullFrameSize(oriented, geometry.straighten);
  const back = toFrame({ x: drawn.x - size.width / 2, y: drawn.y - size.height / 2 }, -geometry.straighten);
  return pixelsToCrop(
    { x: back.x + oriented.width / 2, y: back.y + oriented.height / 2, width: drawn.width, height: drawn.height },
    oriented
  );
}

/** How the picture sits on the canvas: picture pixel `(px, py)` is drawn at `(x + px scale, y + py scale)`. */
export type ViewTransform = Readonly<{ scale: number; x: number; y: number }>;

/** The view that fits a picture into a canvas, centred, leaving `margin` canvas pixels around it. */
export function fitView(canvas: Size, picture: Size, margin = 0): ViewTransform {
  const scale = Math.max(
    1e-6,
    Math.min((canvas.width - 2 * margin) / picture.width, (canvas.height - 2 * margin) / picture.height)
  );
  return {
    scale,
    x: (canvas.width - picture.width * scale) / 2,
    y: (canvas.height - picture.height * scale) / 2,
  };
}
