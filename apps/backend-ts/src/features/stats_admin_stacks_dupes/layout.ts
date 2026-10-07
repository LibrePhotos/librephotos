// api/color_palettes.py::hex_palette and api/social_graph.py::_spring_layout
// (Fruchterman-Reingold vendored from NetworkX) with numpy's default_rng(42)
// start positions, so coordinates match Django's for the same node order.
// Port of lp_api::stats_admin_stacks_dupes::{palette, layout}.

const PAIRED = ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a", "#ffff99", "#b15928"];

/** hex_palette("paired", n): the Paired colors, cycled. */
export const pairedPalette = (n: number) => Array.from({ length: n }, (_, i) => PAIRED[i % PAIRED.length]);

/** colorsys.hls_to_rgb */
function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  return [hlsValue(m1, m2, h + 1 / 3), hlsValue(m1, m2, h), hlsValue(m1, m2, h - 1 / 3)];
}

function hlsValue(m1: number, m2: number, hue: number): number {
  hue = ((hue % 1) + 1) % 1;
  if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  return m1;
}

const hex2 = (v: number) => Math.min(255, Math.max(0, Math.trunc(v * 255))).toString(16).padStart(2, "0");

/** hex_palette("hls", n): evenly spaced hues, lightness 0.6, saturation 0.65. */
export const hlsPalette = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const [r, g, b] = hlsToRgb(i / n, 0.6, 0.65);
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  });

const M128 = (1n << 128n) - 1n;
const M64 = (1n << 64n) - 1n;
const PCG_MULT = 0x2360ed051fc65da44385df649fccf645n;

/** SeedSequence(seed).generate_state(n_words, np.uint32) (pool size 4). */
function seedSequenceState(seed: number, nWords: number): number[] {
  const INIT_A = 0x43b0d7e5, MULT_A = 0x931e8875, INIT_B = 0x8b51f9dd, MULT_B = 0x58f38ded;
  const MIX_L = 0xca01f9dd, MIX_R = 0x4973f715;
  let hashConst = INIT_A;
  const hashmix = (value: number) => {
    let v = (value ^ hashConst) >>> 0;
    hashConst = Math.imul(hashConst, MULT_A) >>> 0;
    v = Math.imul(v, hashConst) >>> 0;
    return (v ^ (v >>> 16)) >>> 0;
  };
  const mix = (x: number, y: number) => {
    const r = (Math.imul(MIX_L, x) - Math.imul(MIX_R, y)) >>> 0;
    return (r ^ (r >>> 16)) >>> 0;
  };
  const pool = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) pool[i] = hashmix(i === 0 ? seed >>> 0 : 0);
  for (let src = 0; src < 4; src++)
    for (let dst = 0; dst < 4; dst++) if (src !== dst) pool[dst] = mix(pool[dst], hashmix(pool[src]));
  let hc = INIT_B;
  const out: number[] = [];
  for (let i = 0; i < nWords; i++) {
    let v = (pool[i % 4] ^ hc) >>> 0;
    hc = Math.imul(hc, MULT_B) >>> 0;
    v = Math.imul(v, hc) >>> 0;
    out.push((v ^ (v >>> 16)) >>> 0);
  }
  return out;
}

/** np.random.default_rng(seed): SeedSequence -> PCG64 (XSL-RR 128/64). */
export class NumpyRng {
  private state = 0n;
  private inc: bigint;
  constructor(seed: number) {
    const w = seedSequenceState(seed, 8);
    const word = (i: number) => BigInt(w[2 * i]) | (BigInt(w[2 * i + 1]) << 32n);
    const initstate = (word(0) << 64n) | word(1);
    const initseq = (word(2) << 64n) | word(3);
    this.inc = ((initseq << 1n) | 1n) & M128;
    this.step();
    this.state = (this.state + initstate) & M128;
    this.step();
  }
  private step() {
    this.state = (this.state * PCG_MULT + this.inc) & M128;
  }
  nextU64(): bigint {
    this.step();
    const s = this.state;
    const rot = s >> 122n;
    const x = ((s >> 64n) ^ s) & M64;
    return ((x >> rot) | (x << ((64n - rot) & 63n))) & M64;
  }
  /** Generator.random(): a double in [0, 1). */
  random(): number {
    return Number(this.nextU64() >> 11n) * (1 / 9007199254740992);
  }
}

/**
 * Positions for nodes 0..n with undirected edges, in the same operation
 * order as the numpy code (so results agree to the bit).
 */
export function springLayout(n: number, edges: [number, number][], k: number, scale: number, iterations: number): [number, number][] {
  if (n === 0) return [];
  const rng = new NumpyRng(42);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = rng.random() * 2 - 1;
    py[i] = rng.random() * 2 - 1;
  }
  let t = Math.max(n * 0.1, 0.1);
  const dt = t / (iterations + 1);
  const k2 = k * k;
  const dx = new Float64Array(n * n);
  const dy = new Float64Array(n * n);
  const dist = new Float64Array(n * n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = px[i] - px[j];
        const b = py[i] - py[j];
        dx[i * n + j] = a;
        dy[i * n + j] = b;
        dist[i * n + j] = i === j ? 1e-10 : Math.sqrt(a * a + b * b);
      }
    const ox = new Float64Array(n);
    const oy = new Float64Array(n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const dd = dist[i * n + j];
        const f = k2 / (dd * dd);
        ox[i] += f * dx[i * n + j];
        oy[i] += f * dy[i * n + j];
      }
    for (const [a, b] of edges) {
      const f = dist[a * n + b] / k;
      const ax = f * dx[a * n + b];
      const ay = f * dy[a * n + b];
      ox[a] -= ax;
      oy[a] -= ay;
      ox[b] += ax;
      oy[b] += ay;
    }
    for (let i = 0; i < n; i++) {
      let norm = Math.sqrt(ox[i] * ox[i] + oy[i] * oy[i]);
      if (norm < 1e-10) norm = 1e-10;
      const m = Math.min(norm, t);
      px[i] += (ox[i] / norm) * m;
      py[i] += (oy[i] / norm) * m;
    }
    t -= dt;
  }
  let lim = -Infinity;
  for (let i = 0; i < n; i++) lim = Math.max(lim, Math.abs(px[i]), Math.abs(py[i]));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push(lim > 0 ? [(px[i] * scale) / lim, (py[i] * scale) / lim] : [px[i], py[i]]);
  return out;
}
