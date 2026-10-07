// Perceptual hash distance (api.perceptual_hash.hamming_distance) and the
// neighbour search of the duplicate job: a 4-block multi-index over 64-bit
// hashes (a BK-tree for other lengths) instead of Django's O(n^2) cross-batch
// pass (same pairs, same groups). Port of jobs/{phash,dupes}.rs.

/** Distance Django reports for hashes it cannot compare. */
export const MAX_DISTANCE = 64;

function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/**
 * A hex pHash as 32-bit words (big-endian per 8 hex digits).
 * imagehash.hex_to_hash reads a square bit matrix, so only lengths whose bit
 * count is a perfect square are hashes.
 */
export class PHash {
  constructor(
    readonly len: number,
    readonly words: Uint32Array,
  ) {}
  static parse(hex: string): PHash | null {
    const bits = hex.length * 4;
    const side = Math.floor(Math.sqrt(bits));
    if (!hex.length || side * side !== bits || !/^[0-9a-fA-F]+$/.test(hex)) return null;
    const words = new Uint32Array(Math.ceil(hex.length / 8));
    for (let i = 0; i < words.length; i++) words[i] = parseInt(hex.slice(i * 8, i * 8 + 8), 16) >>> 0;
    return new PHash(hex.length, words);
  }
  distance(o: PHash): number {
    if (this.len !== o.len) return MAX_DISTANCE;
    let d = 0;
    for (let i = 0; i < this.words.length; i++) d += popcount32(this.words[i] ^ o.words[i]);
    return d;
  }
}

/** hamming_distance(hash1, hash2) */
export function hamming(a: string, b: string): number {
  const pa = PHash.parse(a);
  const pb = PHash.parse(b);
  return pa && pb ? pa.distance(pb) : MAX_DISTANCE;
}

/** Burkhard-Keller tree of equal-length hashes (a true metric space). */
class BkTree {
  private hashes: PHash[] = [];
  private items: number[] = [];
  private children: [number, number][][] = [];
  insert(hash: PHash, item: number) {
    const idx = this.hashes.length;
    if (idx > 0) {
      let at = 0;
      for (;;) {
        const d = this.hashes[at].distance(hash);
        const child = this.children[at].find(([cd]) => cd === d);
        if (!child) {
          this.children[at].push([d, idx]);
          break;
        }
        at = child[1];
      }
    }
    this.hashes.push(hash);
    this.items.push(item);
    this.children.push([]);
  }
  search(hash: PHash, threshold: number, out: number[]) {
    if (!this.hashes.length) return;
    const stack = [0];
    while (stack.length) {
      const at = stack.pop()!;
      const d = this.hashes[at].distance(hash);
      if (d <= threshold) out.push(this.items[at]);
      const lo = Math.max(0, d - threshold);
      const hi = d + threshold;
      for (const [cd, c] of this.children[at]) if (cd >= lo && cd <= hi) stack.push(c);
    }
  }
}

/**
 * Every pair (i, j), j < i, of 64-bit hashes (hi/lo words) within threshold,
 * in order of i then j. Multi-index hashing: two hashes within threshold
 * agree within threshold/4 bits on at least one of their four 16-bit blocks
 * (pigeonhole), so each hash probes only its blocks' near-variant buckets.
 * Larger radii fall back to a popcount scan of every earlier hash.
 */
function forEachEarlierNeighbour(hi: Uint32Array, lo: Uint32Array, threshold: number, f: (i: number, j: number) => void) {
  const n = hi.length;
  if (!n) return;
  const block = (i: number, b: number) => (b === 0 ? lo[i] & 0xffff : b === 1 ? lo[i] >>> 16 : b === 2 ? hi[i] & 0xffff : hi[i] >>> 16);
  const dist = (i: number, j: number) => popcount32(hi[i] ^ hi[j]) + popcount32(lo[i] ^ lo[j]);
  const radius = Math.floor(threshold / 4);
  if (radius > 3) {
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (dist(i, j) <= threshold) f(i, j);
    return;
  }
  const offsets: Uint32Array[] = [];
  const items: Uint32Array[] = [];
  for (let b = 0; b < 4; b++) {
    const counts = new Uint32Array(65537);
    for (let i = 0; i < n; i++) counts[block(i, b) + 1]++;
    for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
    const fill = counts.slice();
    const list = new Uint32Array(n);
    for (let i = 0; i < n; i++) list[fill[block(i, b)]++] = i;
    offsets.push(counts);
    items.push(list);
  }
  const variants: number[] = [];
  for (let m = 0; m <= 0xffff; m++) if (popcount32(m) <= radius) variants.push(m);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.length = 0;
    for (let b = 0; b < 4; b++) {
      const key = block(i, b);
      const off = offsets[b];
      const list = items[b];
      for (const flip of variants) {
        const k = key ^ flip;
        for (let p = off[k], end = off[k + 1]; p < end; p++) {
          const j = list[p];
          // Buckets list items in ascending order.
          if (j >= i) break;
          // Reported through the first block that matches.
          let earlier = false;
          for (let e = 0; e < b; e++) {
            if (popcount32(block(i, e) ^ block(j, e)) <= radius) {
              earlier = true;
              break;
            }
          }
          if (!earlier && dist(i, j) <= threshold) out.push(j);
        }
      }
    }
    out.sort((a, b) => a - b);
    for (const j of out) f(i, j);
  }
}

/**
 * Every pair within threshold among hashes (by position), as f(later,
 * earlier): other lengths inline in input order, then the 64-bit ones.
 * Unparsable hashes sit at distance 64 from everything, as in Django.
 */
export function forEachVisualPair(hashes: string[], threshold: number, f: (i: number, j: number) => void) {
  if (threshold < 0) return;
  const parsed = hashes.map((h) => PHash.parse(h));
  if (threshold >= MAX_DISTANCE) {
    // Everything within 64 of everything else: no pruning is possible.
    for (let i = 0; i < parsed.length; i++)
      for (let j = 0; j < i; j++) {
        const a = parsed[i];
        const b = parsed[j];
        if ((a && b ? a.distance(b) : MAX_DISTANCE) <= threshold) f(i, j);
      }
    return;
  }
  const global: number[] = [];
  const trees = new Map<number, BkTree>();
  const found: number[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (!p) continue;
    if (hashes[i].length === 16) {
      global.push(i);
      continue;
    }
    let tree = trees.get(hashes[i].length);
    if (!tree) trees.set(hashes[i].length, (tree = new BkTree()));
    found.length = 0;
    tree.search(p, threshold, found);
    found.sort((a, b) => a - b);
    for (const j of found) f(i, j);
    tree.insert(p, i);
  }
  const hi = new Uint32Array(global.length);
  const lo = new Uint32Array(global.length);
  global.forEach((g, k) => {
    const w = parsed[g]!.words;
    hi[k] = w[0];
    lo[k] = w[1];
  });
  forEachEarlierNeighbour(hi, lo, threshold, (i, j) => f(global[i], global[j]));
}

/** Union-find with path compression and union by rank; groups in first-seen order (UnionFind.get_groups). */
export class UnionFind {
  private index = new Map<string, number>();
  private keys: string[] = [];
  private parent: number[] = [];
  private rank: number[] = [];
  private slot(x: string) {
    let i = this.index.get(x);
    if (i === undefined) {
      i = this.parent.length;
      this.index.set(x, i);
      this.keys.push(x);
      this.parent.push(i);
      this.rank.push(0);
    }
    return i;
  }
  private root(i: number) {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: string, b: string) {
    const sa = this.slot(a);
    const sb = this.slot(b);
    let ra = this.root(sa);
    let rb = this.root(sb);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
  }
  /** Groups of two or more. */
  groups(): string[][] {
    const byRoot = new Map<number, string[]>();
    this.keys.forEach((k, i) => {
      const r = this.root(i);
      const g = byRoot.get(r);
      if (g) g.push(k);
      else byRoot.set(r, [k]);
    });
    return [...byRoot.values()].filter((g) => g.length > 1);
  }
}
