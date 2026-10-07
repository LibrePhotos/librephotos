// `cv2.findContours(bitmap, RETR_LIST, CHAIN_APPROX_SIMPLE)` (port of
// lp_ml::ocr::ppocr::contours): OpenCV 5's Suzuki-Abe border following
// (imgproc/src/contours_new.cpp, the path the Python binding takes), with
// the same point order and the same contour order (last found first).

/** A point list `[x0, y0, x1, y1, ...]`. */
export type Contour = number[];

// Chain code directions: right, up-right, up, up-left, left, down-left, down, down-right.
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];

/** `nbd | MASK8_RIGHT` as a signed byte. */
const RIGHT = ((0x02 | 0x80) << 24) >> 24;
const NEW = 0x02;

/** Contours of the non-zero pixels of a `w` x `h` bitmap (the compressed chains). */
export function findContours(bitmap: Uint8Array, w: number, h: number): Contour[] {
  if (bitmap.length !== w * h) throw new Error("bitmap size");
  const step = w + 2;
  const img = new Int8Array(step * (h + 2));
  for (let y = 0; y < h; y++) {
    const o = (y + 1) * step + 1;
    for (let x = 0; x < w; x++) img[o + x] = bitmap[y * w + x] !== 0 ? 1 : 0;
  }
  const delta = new Int32Array(8);
  for (let s = 0; s < 8; s++) delta[s] = DX[s] + DY[s] * step;
  const width = step - 1;
  const height = h + 2 - 1;

  const found: Contour[] = [];
  let x = 1;
  let y = 1;
  let prev = img[y * step + x - 1];
  while (y < height) {
    let p = 0;
    while (x < width) {
      while (x < width) {
        p = img[y * step + x];
        if (p !== prev) break;
        x++;
      }
      if (x >= width) break;
      let isHole: boolean | null = null;
      if (prev === 0 && p === 1) isHole = false;
      else if (p === 0 && prev >= 1) isHole = true;
      if (isHole !== null) {
        const sx = x - (isHole ? 1 : 0);
        found.push(fetch(img, step, sx, y, isHole, delta));
        // The scan resumes right after the start pixel, re-reading the
        // (now marked) pixel to its left.
        x++;
        prev = img[y * step + x - 1];
        continue;
      }
      prev = p;
      x++;
    }
    y++;
    x = 1;
    prev = 0;
  }
  found.reverse();
  return found;
}

/**
 * `icvFetchContourEx<schar>` with CHAIN_APPROX_SIMPLE: follow one border
 * from (sx, sy) (padded coordinates), marking it; its corner points in
 * image coordinates.
 */
function fetch(img: Int8Array, step: number, sx: number, sy: number, isHole: boolean, delta: Int32Array): Contour {
  const points: Contour = [];
  const i0 = sy * step + sx;
  let ptx = sx - 1;
  let pty = sy - 1;
  let sEnd = isHole ? 0 : 4;
  let s = sEnd;
  let i1: number;
  for (;;) {
    s = (s - 1) & 7;
    i1 = i0 + delta[s];
    if (img[i1] !== 0 || s === sEnd) break;
  }
  if (s === sEnd) {
    img[i0] = RIGHT;
    points.push(ptx, pty);
    return points;
  }
  let i3 = i0;
  let prevS = s ^ 4;
  for (;;) {
    sEnd = s;
    s = Math.min(s, 15);
    let i4 = i3;
    while (s < 15) {
      s++;
      i4 = i3 + delta[s & 7];
      if (img[i4] !== 0) break;
    }
    s &= 7;
    if ((s - 1) >>> 0 < sEnd >>> 0) img[i3] = RIGHT;
    else if (img[i3] === 1) img[i3] = NEW;
    if (s !== prevS) points.push(ptx, pty);
    prevS = s;
    ptx += DX[s];
    pty += DY[s];
    if (i4 === i0 && i3 === i1) break;
    i3 = i4;
    s = (s + 4) & 7;
  }
  return points;
}
