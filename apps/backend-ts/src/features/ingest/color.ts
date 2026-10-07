// Thumbnail._get_dominant_color (port of lp-ingest color.rs): the small
// thumbnail shrunk into a 100x100 box (Pillow `thumbnail`, BICUBIC),
// quantized to 16 colours by median cut, the most frequent palette entry as
// "[r, g, b]". The resize follows Pillow's fixed-point resampler; the median
// cut is a close reimplementation (the value is a cosmetic placeholder tint).
import { clip8, precompute } from "./phash";

const ONE = 2 ** 22;

/** Pillow's two-pass resample of an RGB buffer with a float source box. */
function resampleRgb(src: Uint8Array, w: number, h: number, bx: [number, number, number, number], ow: number, oh: number): Uint8Array {
  const horiz = precompute(w, bx[0], bx[2], ow, "bicubic");
  const vert = precompute(h, bx[1], bx[3], oh, "bicubic");
  const needH = ow !== w || bx[0] !== 0 || bx[2] !== ow;
  const needV = oh !== h || bx[1] !== 0 || bx[3] !== oh;
  const first = vert.xmin[0];
  const last = vert.xmin[oh - 1] + vert.n[oh - 1];
  let cur = src;
  let cw = w;
  let off = 0;
  if (needH) {
    const th = last - first;
    const tmp = new Uint8Array(ow * th * 3);
    for (let yy = 0; yy < th; yy++) {
      const row = (yy + first) * w;
      for (let xx = 0; xx < ow; xx++) {
        const xmin = horiz.xmin[xx];
        const n = horiz.n[xx];
        const kb = xx * horiz.ksize;
        for (let c = 0; c < 3; c++) {
          let s = ONE / 2;
          for (let x = 0; x < n; x++) s += src[(row + x + xmin) * 3 + c] * horiz.kk[kb + x];
          tmp[(yy * ow + xx) * 3 + c] = clip8(s);
        }
      }
    }
    cur = tmp;
    cw = ow;
    off = first;
  }
  if (!needV) return cur;
  const out = new Uint8Array(cw * oh * 3);
  for (let yy = 0; yy < oh; yy++) {
    const ymin = vert.xmin[yy] - off;
    const n = vert.n[yy];
    const kb = yy * vert.ksize;
    for (let xx = 0; xx < cw; xx++) {
      for (let c = 0; c < 3; c++) {
        let s = ONE / 2;
        for (let y = 0; y < n; y++) s += cur[((y + ymin) * cw + xx) * 3 + c] * vert.kk[kb + y];
        out[(yy * cw + xx) * 3 + c] = clip8(s);
      }
    }
  }
  return out;
}

/** Pillow Image.reduce(factor): box average with rounding. */
function reduceRgb(src: Uint8Array, w: number, h: number, fx: number, fy: number): [Uint8Array, number, number] {
  const ow = Math.ceil(w / fx);
  const oh = Math.ceil(h / fy);
  const out = new Uint8Array(ow * oh * 3);
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      const x0 = ox * fx;
      const y0 = oy * fy;
      const x1 = Math.min(x0 + fx, w);
      const y1 = Math.min(y0 + fy, h);
      const n = (x1 - x0) * (y1 - y0);
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += src[(y * w + x) * 3 + c];
        out[(oy * ow + ox) * 3 + c] = Math.floor((s + Math.floor(n / 2)) / n);
      }
    }
  }
  return [out, ow, oh];
}

/** Image.thumbnail((100, 100)) target size (Pillow's preserve_aspect_ratio). */
export function thumbnailSize(w: number, h: number, bx: number, by: number): [number, number] | null {
  if (bx >= w && by >= h) return null;
  const aspect = w / h;
  const roundAspect = (number: number, key: (n: number) => number) => {
    const f = Math.floor(number);
    const c = Math.ceil(number);
    return Math.max(key(c) < key(f) ? c : f, 1);
  };
  if (bx / by >= aspect) return [roundAspect(by * aspect, (n) => Math.abs(aspect - n / by)), by];
  return [bx, roundAspect(bx / aspect, (n) => (n === 0 ? 0 : Math.abs(aspect - bx / n)))];
}

interface CBox {
  colors: [number, number][]; // [packed rgb, count]
  count: number;
  path: string; // "0"/"1" per split from the root, for Pillow's leaf numbering
  seq: number;
}

const ch = (c: number, a: number) => (c >> (16 - 8 * a)) & 0xff;

function volume(colors: [number, number][]): number {
  let v = 1;
  for (let a = 0; a < 3; a++) {
    let lo = 255;
    let hi = 0;
    for (const [c] of colors) {
      const x = ch(c, a);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    v *= hi - lo + 1;
  }
  return v;
}

/** Pillow Quant.c median_cut + split + splitlists. */
function medianCut(hist: [number, number][], n: number): CBox[] {
  const total = hist.reduce((s, [, c]) => s + c, 0);
  let seq = 0;
  const heap: CBox[] = [{ colors: hist, count: total, path: "", seq }];
  const leaves: CBox[] = [];
  for (let remaining = n; remaining > 1; remaining--) {
    let node: CBox | null = null;
    while (heap.length) {
      let bi = 0;
      for (let i = 1; i < heap.length; i++) {
        const a = heap[i];
        const b = heap[bi];
        if (a.count > b.count || (a.count === b.count && a.seq < b.seq)) bi = i;
      }
      const b = heap[bi];
      heap[bi] = heap[heap.length - 1];
      heap.pop();
      if (volume(b.colors) === 1) {
        leaves.push(b);
        continue;
      }
      node = b;
      break;
    }
    if (!node) break;
    const range = (a: number) => {
      let lo = 255;
      let hi = 0;
      for (const [c] of node!.colors) {
        const x = ch(c, a);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      return hi - lo;
    };
    const f = [range(0) * 77, range(1) * 150, range(2) * 29];
    let axis = 0;
    for (let i = 1; i < 3; i++) if (f[i] > f[axis]) axis = i;
    // Stable sort descending by the axis value (Rust's sort_by is stable).
    node.colors.sort((x, y) => ch(y[0], axis) - ch(x[0], axis));
    let left = 0;
    let cut = node.colors.length;
    for (let i = 0; i < node.colors.length; i++) {
      left += node.colors[i][1];
      if (left * 2 > node.count) {
        cut = i + 1;
        break;
      }
    }
    if (cut < node.colors.length) {
      const v = ch(node.colors[cut - 1][0], axis);
      while (cut < node.colors.length && ch(node.colors[cut][0], axis) === v) cut++;
    }
    if (cut === node.colors.length) {
      const v = ch(node.colors[cut - 1][0], axis);
      while (cut > 0 && ch(node.colors[cut - 1][0], axis) === v) cut--;
    }
    const right = node.colors.slice(cut);
    const leftColors = node.colors.slice(0, cut);
    const lc = leftColors.reduce((s, [, c]) => s + c, 0);
    const rc = right.reduce((s, [, c]) => s + c, 0);
    heap.push({ colors: leftColors, count: lc, path: node.path + "0", seq: ++seq });
    heap.push({ colors: right, count: rc, path: node.path + "1", seq: ++seq });
  }
  leaves.push(...heap);
  return leaves.filter((b) => b.colors.length).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Dominant colour of RGB pixels. */
export function dominantRgb(rgb: Uint8Array, w: number, h: number): [number, number, number] | null {
  if (!w || !h) return null;
  let px = rgb;
  let pw = w;
  let ph = h;
  const size = thumbnailSize(w, h, 100, 100);
  if (size) {
    const [tw, th] = size;
    const gap = 2;
    const fx = Math.max(Math.trunc(w / tw / gap), 1);
    const fy = Math.max(Math.trunc(h / th / gap), 1);
    let bx: [number, number, number, number] = [0, 0, w, h];
    if (fx > 1 || fy > 1) {
      [px, pw, ph] = reduceRgb(px, pw, ph, fx, fy);
      bx = [0, 0, w / fx, h / fy];
    }
    px = resampleRgb(px, pw, ph, bx, tw, th);
  }
  const counts = new Map<number, number>();
  for (let i = 0; i + 2 < px.length; i += 3) {
    const c = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const hist = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const boxes = medianCut(hist, 16);
  const palette: number[][] = [];
  const boxOf = new Map<number, number>();
  boxes.forEach((b, i) => {
    const sum = [0, 0, 0];
    for (const [c, n] of b.colors) {
      for (let a = 0; a < 3; a++) sum[a] += ch(c, a) * n;
      boxOf.set(c, i);
    }
    const n = Math.max(b.count, 1);
    palette.push(sum.map((s) => Math.trunc(0.5 + s / n)));
  });
  const dist = (p: number[], c: number) => {
    let d = 0;
    for (let a = 0; a < 3; a++) d += (p[a] - ch(c, a)) ** 2;
    return d;
  };
  const hits = new Array(palette.length).fill(0);
  for (const b of boxes) {
    for (const [c, n] of b.colors) {
      let best = boxOf.get(c)!;
      let bd = dist(palette[best], c);
      for (let j = 0; j < palette.length; j++) {
        const d = dist(palette[j], c);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      hits[best] += n;
    }
  }
  if (!palette.length) return null;
  let idx = 0;
  for (let i = 1; i < hits.length; i++) if (hits[i] >= hits[idx]) idx = i;
  return palette[idx] as [number, number, number];
}

export const formatDominant = (rgb: [number, number, number]) => `[${rgb[0]}, ${rgb[1]}, ${rgb[2]}]`;
