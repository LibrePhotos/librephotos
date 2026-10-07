// A flat inner-product index (FAISS IndexFlatIP) over 512-d f32 CLIP
// embeddings and its on-disk form (port of lp_ml::similarity::index; the
// same file format, so librephotos-rs and -ts read each other's indices).
//
// File `similarity/<user_id>.f32`: `LPSIMF32`, u32 version, u32 dim, u64 n
// (little-endian), then n * dim f32 LE, then the n image hashes joined by
// "\n". Written to a temporary name and renamed into place.
import { closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";

/** `embedding_size` of retrieval_index.py. */
export const EMBEDDING_SIZE = 512;
const MAGIC = "LPSIMF32";
const VERSION = 1;
const HEADER = 8 + 4 + 4 + 8;

const f = Math.fround;

/**
 * f32 inner product exactly as FAISS 1.15's AVX2 `fvec_inner_product`
 * computes it: 8 lanes, multiply then add (no FMA), lanes reduced by
 * halves. Near-equal neighbours then rank as in FAISS.
 */
export function dot(a: Float32Array, ao: number, b: ArrayLike<number>, n = EMBEDDING_SIZE): number {
  let a0 = 0,
    a1 = 0,
    a2 = 0,
    a3 = 0,
    a4 = 0,
    a5 = 0,
    a6 = 0,
    a7 = 0;
  const full = n - (n % 8);
  for (let i = 0; i < full; i += 8) {
    const o = ao + i;
    a0 = f(a0 + f(a[o] * b[i]));
    a1 = f(a1 + f(a[o + 1] * b[i + 1]));
    a2 = f(a2 + f(a[o + 2] * b[i + 2]));
    a3 = f(a3 + f(a[o + 3] * b[i + 3]));
    a4 = f(a4 + f(a[o + 4] * b[i + 4]));
    a5 = f(a5 + f(a[o + 5] * b[i + 5]));
    a6 = f(a6 + f(a[o + 6] * b[i + 6]));
    a7 = f(a7 + f(a[o + 7] * b[i + 7]));
  }
  const h0 = f(a0 + a4),
    h1 = f(a1 + a5),
    h2 = f(a2 + a6),
    h3 = f(a3 + a7);
  let s = f(f(h0 + h2) + f(h1 + h3));
  for (let i = full; i < n; i++) s = f(s + f(a[ao + i] * b[i]));
  return s;
}

export class FlatIndex {
  private data: Float32Array;
  private n = 0;
  readonly hashes: string[] = [];

  constructor(capacity = 0) {
    this.data = new Float32Array(capacity * EMBEDDING_SIZE);
  }

  get length() {
    return this.n;
  }

  vector(i: number): Float32Array {
    return this.data.subarray(i * EMBEDDING_SIZE, (i + 1) * EMBEDDING_SIZE);
  }

  /** Append vectors; every one must have EMBEDDING_SIZE components. */
  add(hashes: string[], embeddings: ArrayLike<number>[]): void {
    if (hashes.length !== embeddings.length) throw new Error(`${hashes.length} image hashes for ${embeddings.length} embeddings`);
    const bad = embeddings.find((e) => e.length !== EMBEDDING_SIZE);
    if (bad) throw new Error(`embeddings of the wrong shape: expected embedding size ${EMBEDDING_SIZE}, got ${bad.length}`);
    const need = (this.n + embeddings.length) * EMBEDDING_SIZE;
    if (need > this.data.length) {
      const grown = new Float32Array(Math.max(need, this.data.length * 2));
      grown.set(this.data.subarray(0, this.n * EMBEDDING_SIZE));
      this.data = grown;
    }
    for (const e of embeddings) {
      this.data.set(e, this.n * EMBEDDING_SIZE);
      this.n++;
    }
    this.hashes.push(...hashes);
  }

  /**
   * `search_similar`: the `n` best inner products that reach `threshold`,
   * best first, ties listed by descending position as the sidecar's
   * `sorted(zip(dist, idx), reverse=True)` does; of equal scores straddling
   * the `n` cut the lower positions are kept. The threshold is compared in
   * f32, as numpy 2 compares `np.float32 >= float`.
   */
  search(query: ArrayLike<number>, n: number, threshold: number): string[] {
    if (query.length !== EMBEDDING_SIZE) throw new Error(`query embedding has ${query.length} components, the index ${EMBEDDING_SIZE}`);
    if (n === 0 || this.n === 0) return [];
    const t = f(threshold);
    const q = Float32Array.from(query);
    const hits: [number, number][] = [];
    for (let i = 0; i < this.n; i++) {
      const s = dot(this.data, i * EMBEDDING_SIZE, q);
      if (s >= t) hits.push([s, i]);
    }
    let kept = hits;
    if (hits.length > n) {
      hits.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      kept = hits.slice(0, n);
    }
    kept.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    return kept.map(([, i]) => this.hashes[i]);
  }

  toBytes(): Uint8Array {
    const hashes = new TextEncoder().encode(this.hashes.join("\n"));
    const out = new Uint8Array(HEADER + this.n * EMBEDDING_SIZE * 4 + hashes.length);
    const dv = new DataView(out.buffer);
    out.set(new TextEncoder().encode(MAGIC));
    dv.setUint32(8, VERSION, true);
    dv.setUint32(12, EMBEDDING_SIZE, true);
    dv.setBigUint64(16, BigInt(this.n), true);
    // Little-endian hosts: the f32 bytes as they are.
    out.set(new Uint8Array(this.data.buffer, this.data.byteOffset, this.n * EMBEDDING_SIZE * 4), HEADER);
    out.set(hashes, HEADER + this.n * EMBEDDING_SIZE * 4);
    return out;
  }

  static fromBytes(bytes: Uint8Array): FlatIndex {
    const n = parseHeader(bytes);
    const body = n * EMBEDDING_SIZE * 4;
    if (bytes.length < HEADER + body) throw new Error(`truncated: ${n} vectors need ${HEADER + body} bytes`);
    const idx = new FlatIndex(0);
    const data = new Float32Array(n * EMBEDDING_SIZE);
    new Uint8Array(data.buffer).set(bytes.subarray(HEADER, HEADER + body));
    idx.data = data;
    idx.n = n;
    idx.hashes.push(...splitHashes(new TextDecoder().decode(bytes.subarray(HEADER + body)), n));
    return idx;
  }

  static read(file: string): FlatIndex {
    try {
      return FlatIndex.fromBytes(readFileSync(file));
    } catch (e) {
      throw new Error(`similarity index ${file}: ${(e as Error).message}`);
    }
  }

  /** Write atomically (temporary file in the same directory, fsync, rename). */
  write(file: string): void {
    const dir = path.dirname(file);
    mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(file, path.extname(file))}.${process.pid}.${Date.now()}.tmp`);
    const fd = openSync(tmp, "w");
    try {
      const bytes = this.toBytes();
      let off = 0;
      while (off < bytes.length) off += writeSync(fd, bytes, off, bytes.length - off);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tmp, file);
    } catch (e) {
      try {
        unlinkSync(tmp);
      } catch {
        /* gone */
      }
      throw new Error(`replacing ${file}: ${(e as Error).message}`);
    }
  }
}

function splitHashes(text: string, n: number): string[] {
  const hashes = n === 0 && text === "" ? [] : text.split("\n");
  if (hashes.length !== n) throw new Error(`${n} vectors for ${hashes.length} image hashes`);
  return hashes;
}

function parseHeader(bytes: Uint8Array): number {
  if (bytes.length < HEADER || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) throw new Error("not a similarity index");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(8, true);
  if (version !== VERSION) throw new Error(`unsupported version ${version}`);
  const dim = dv.getUint32(12, true);
  if (dim !== EMBEDDING_SIZE) throw new Error(`dimension ${dim}, expected ${EMBEDDING_SIZE}`);
  const n = dv.getBigUint64(16, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) / BigInt(EMBEDDING_SIZE * 4)) throw new Error("index size overflows");
  return Number(n);
}

/**
 * The vector count of a stored index, reading its header and hash list (not
 * the vectors); null when the file is missing, not an index, too short, or
 * holds another number of hashes (a torn file the startup check rebuilds).
 */
export function storedLen(file: string): number | null {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const head = new Uint8Array(HEADER);
    if (readSync(fd, head, 0, HEADER, 0) !== HEADER) return null;
    const n = parseHeader(head);
    const end = HEADER + n * EMBEDDING_SIZE * 4;
    const size = fstatSync(fd).size;
    if (size < end) return null;
    const rest = new Uint8Array(size - end);
    if (rest.length && readSync(fd, rest, 0, rest.length, end) !== rest.length) return null;
    splitHashes(new TextDecoder().decode(rest), n);
    return n;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** `<dir>/<user_id>.f32`. */
export const indexPath = (dir: string, userId: number) => path.join(dir, `${userId}.f32`);

/** (size, mtime) of a file, null when missing. */
export function stamp(file: string): string | null {
  try {
    const s = statSync(file);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return null;
  }
}
