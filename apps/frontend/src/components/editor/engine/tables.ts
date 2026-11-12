/**
 * The tables and per-render values of the develop stage, exactly as the pipeline doc specifies them
 * (apps/docs/docs/development/photo-editing.md, stage 4). The server computes the same ones
 * (api/editing/tables.py), and the goldens hold both to 1e-4.
 */
import { EDIT_BANDS } from "@librephotos/api-client";
import type { CurvePoints, Recipe } from "./recipe";

/** Luminance weights of linear sRGB. */
export const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** Entries of the light and tone curve tables; entry `i` is at `x = i / 1023`. */
export const TABLE_SIZE = 1024;
/** Entries of the hue table; entry `i` is at `h = i` degrees. */
const HUE_TABLE_SIZE = 360;
/** Where each mixer band sits on the hue circle, in degrees, in the order of EDIT_BANDS. */
const BAND_HUES = [29, 55, 105, 142, 195, 262, 298, 330] as const;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Stage 4.6: the light table (Whites, Blacks, Contrast), 1024 entries. */
export function lightTable(light: Recipe["light"]): Float32Array {
  const b = light.blacks / 100;
  const w = light.whites / 100;
  const q = 2 ** (0.75 * (light.contrast / 100));
  const table = new Float32Array(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; i++) {
    const x = i / (TABLE_SIZE - 1);
    const x1 = clamp(x + 0.15 * b * (1 - x) ** 3 + 0.15 * w * x ** 3, 0, 1);
    table[i] = x1 < 0.5 ? 0.5 * (2 * x1) ** q : 1 - 0.5 * (2 * (1 - x1)) ** q;
  }
  return table;
}

/** The Fritsch-Carlson tangents of a curve's points. */
function curveTangents(points: CurvePoints): number[] {
  const n = points.length;
  const h: number[] = [];
  const s: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const [x0, y0] = points[k] ?? [0, 0];
    const [x1, y1] = points[k + 1] ?? [1, 1];
    h.push(x1 - x0);
    s.push((y1 - y0) / (x1 - x0));
  }
  const tangents = [s[0] ?? 0];
  for (let k = 1; k < n - 1; k++) {
    const before = s[k - 1] ?? 0;
    const after = s[k] ?? 0;
    const hk = h[k] ?? 0;
    const hPrev = h[k - 1] ?? 0;
    const w1 = 2 * hk + hPrev;
    const w2 = hk + 2 * hPrev;
    tangents.push(before * after <= 0 ? 0 : (w1 + w2) / (w1 / before + w2 / after));
  }
  tangents.push(s[n - 2] ?? 0);
  return tangents;
}

/**
 * A curve's value at `x`: the monotone cubic (Fritsch and Carlson) through its points, `y` of the
 * first point left of it and of the last point right of it.
 */
export function evaluateCurve(points: CurvePoints, x: number, tangents = curveTangents(points)): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return x;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  let k = 0;
  while (k < points.length - 2 && x >= (points[k + 1]?.[0] ?? 1)) k++;
  const [x0, y0] = points[k] ?? first;
  const [x1, y1] = points[k + 1] ?? last;
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const m0 = tangents[k] ?? 0;
  const m1 = tangents[k + 1] ?? 0;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
}

/**
 * Stage 4.8: the tone curve table, 1024 entries of three channels interleaved (`[r0, g0, b0, r1,
 * ...]`): each channel's own curve applied after the master curve, clamped to 0 to 1.
 */
export function curveTable(curve: Recipe["curve"]): Float32Array {
  const channels = [curve.red, curve.green, curve.blue];
  const masterTangents = curveTangents(curve.master);
  const channelTangents = channels.map(curveTangents);
  const table = new Float32Array(TABLE_SIZE * 3);
  for (let i = 0; i < TABLE_SIZE; i++) {
    const master = evaluateCurve(curve.master, i / (TABLE_SIZE - 1), masterTangents);
    channels.forEach((points, c) => {
      table[i * 3 + c] = clamp(evaluateCurve(points, master, channelTangents[c]), 0, 1);
    });
  }
  return table;
}

/**
 * The two bands around a hue and the weight of the second: `[lower, upper, t]` with indices into
 * BAND_HUES (magenta to red included, going round the circle).
 */
export function bandWeights(hue: number): [lower: number, upper: number, t: number] {
  const last = BAND_HUES.length - 1;
  const first = BAND_HUES[0];
  const top = BAND_HUES[last] ?? 360;
  const h = ((hue % 360) + 360) % 360;
  if (h >= top || h < first) {
    const span = first + 360 - top;
    return [last, 0, ((h < first ? h + 360 : h) - top) / span];
  }
  let lower = 0;
  while (lower < last - 1 && h >= (BAND_HUES[lower + 1] ?? 360)) lower++;
  const from = BAND_HUES[lower] ?? 0;
  const to = BAND_HUES[lower + 1] ?? 360;
  return [lower, lower + 1, (h - from) / (to - from)];
}

/**
 * Stage 4.7: the hue table, 360 entries of four values interleaved (`dh` in degrees, `ds`, `dl`,
 * `bw`), from the color mixer and the B&W mix.
 */
export function hueTable(mixer: Recipe["mixer"], bwMix: Recipe["bw_mix"]): Float32Array {
  const table = new Float32Array(HUE_TABLE_SIZE * 4);
  for (let i = 0; i < HUE_TABLE_SIZE; i++) {
    const [lower, upper, t] = bandWeights(i);
    const weighted = (value: (band: (typeof EDIT_BANDS)[number]) => number) => {
      const a = EDIT_BANDS[lower];
      const b = EDIT_BANDS[upper];
      return (a === undefined ? 0 : (1 - t) * value(a)) + (b === undefined ? 0 : t * value(b));
    };
    table[i * 4] = (weighted(band => mixer[band].hue) / 100) * 30;
    table[i * 4 + 1] = weighted(band => mixer[band].sat) / 100;
    table[i * 4 + 2] = weighted(band => mixer[band].lum) / 100;
    table[i * 4 + 3] = weighted(band => bwMix[band]) / 100;
  }
  return table;
}

/** Stage 4.2's per-render values: the white balance multipliers `k`, the exposure `gain` and `M`. */
export type WhiteBalance = { k: Float32Array; gain: number; M: number };

/** Stage 4.2: white balance and exposure of a recipe, for a source whose largest value is `sourceMax`. */
export function whiteBalance(wb: Recipe["wb"], exposure: number, sourceMax: number): WhiteBalance {
  const t = wb.temp / 100;
  const g = wb.tint / 100;
  const raw = [2 ** (0.6 * t), 2 ** (-0.4 * g), 2 ** (-0.6 * t)] as const;
  const norm = raw[0] * LUMA[0] + raw[1] * LUMA[1] + raw[2] * LUMA[2];
  const k = raw.map(value => value / norm);
  const gain = 2 ** exposure;
  const M = Math.max(1, sourceMax * Math.max(...k) * gain);
  return { k: new Float32Array(k), gain, M };
}
