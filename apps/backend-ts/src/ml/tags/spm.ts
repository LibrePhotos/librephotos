// A SentencePiece encoder for BPE models (SigLIP 2's Gemma `tokenizer.model`),
// so its tag embeddings can be rebuilt without the C++ library. Port of
// lp_ml::tags::spm (itself `bpe_model.cc` `Model::Encode` plus the byte
// fallback of `SentencePieceProcessor::Encode`); the protobuf `ModelProto`
// is read by hand. Normalisers other than `identity` are refused.
import { readFileSync } from "node:fs";

const NORMAL = 1;
const UNKNOWN = 2;
const CONTROL = 3;
const USER_DEFINED = 4;
const UNUSED = 5;
const BYTE = 6;
const MODEL_BPE = 2;

type Field = { kind: "varint"; v: number } | { kind: "fixed32"; v: DataView; at: number } | { kind: "bytes"; v: Uint8Array } | { kind: "other" };

class Reader {
  at = 0;
  constructor(private b: Uint8Array) {}

  varint(): number {
    let v = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      if (this.at >= this.b.length) throw new Error("truncated varint");
      const byte = this.b[this.at++];
      v += (byte & 0x7f) * mul;
      mul *= 128;
      if (!(byte & 0x80)) return v;
    }
    throw new Error("varint too long");
  }

  take(n: number): Uint8Array {
    if (!Number.isSafeInteger(n) || this.at + n > this.b.length) throw new Error("truncated protobuf field");
    const s = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return s;
  }

  next(): [number, Field] | null {
    if (this.at >= this.b.length) return null;
    const key = this.varint();
    const wire = key % 8;
    const num = Math.floor(key / 8);
    switch (wire) {
      case 0:
        return [num, { kind: "varint", v: this.varint() }];
      case 1:
        this.take(8);
        return [num, { kind: "other" }];
      case 2:
        return [num, { kind: "bytes", v: this.take(this.varint()) }];
      case 5: {
        const s = this.take(4);
        return [num, { kind: "fixed32", v: new DataView(s.buffer, s.byteOffset, 4), at: 0 }];
      }
      default:
        throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

interface Piece {
  id: number;
  score: number;
  type: number;
}

interface Pair {
  score: number;
  left: number;
  right: number;
  size: number;
}

/** bpe_model.cc's agenda: the highest score first, then the leftmost. */
const before = (a: Pair, b: Pair) => (a.score !== b.score ? a.score > b.score : a.left < b.left);

class Agenda {
  private h: Pair[] = [];
  push(p: Pair) {
    const h = this.h;
    h.push(p);
    let i = h.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!before(h[i], h[up])) break;
      [h[i], h[up]] = [h[up], h[i]];
      i = up;
    }
  }
  pop(): Pair | undefined {
    const h = this.h;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && before(h[l], h[m])) m = l;
        if (r < h.length && before(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

export class SentencePiece {
  /** NORMAL, USER_DEFINED and UNUSED pieces. */
  private pieces = new Map<string, Piece>();
  /** CONTROL, UNKNOWN and BYTE pieces. */
  private reserved = new Map<string, number>();
  /** USER_DEFINED pieces, matched greedily (longest first) before merging. */
  private userDefined: string[] = [];
  private unkId = 0;
  private byteFallback = false;
  private addDummyPrefix = true;
  private removeExtraWhitespaces = true;
  private escapeWhitespaces = true;

  static load(file: string): SentencePiece {
    return SentencePiece.parse(readFileSync(file));
  }

  static parse(bytes: Uint8Array): SentencePiece {
    const sp = new SentencePiece();
    let modelType = 1;
    let normalizer = "nmt_nfkc";
    let charsmap = false;
    let id = 0;
    const r = new Reader(bytes);
    for (let f = r.next(); f; f = r.next()) {
      const [num, field] = f;
      if (num === 1 && field.kind === "bytes") {
        let text = "";
        let score = 0;
        let type = NORMAL;
        const p = new Reader(field.v);
        for (let g = p.next(); g; g = p.next()) {
          const [n, x] = g;
          if (n === 1 && x.kind === "bytes") text = utf8.decode(x.v);
          else if (n === 2 && x.kind === "fixed32") score = x.v.getFloat32(0, true);
          else if (n === 3 && x.kind === "varint") type = x.v;
        }
        if (type === CONTROL || type === UNKNOWN || type === BYTE) sp.reserved.set(text, id);
        else {
          if (type === USER_DEFINED) sp.userDefined.push(text);
          sp.pieces.set(text, { id, score, type });
        }
        if (type === UNKNOWN) sp.unkId = id;
        id++;
      } else if (num === 2 && field.kind === "bytes") {
        const t = new Reader(field.v);
        for (let g = t.next(); g; g = t.next()) {
          const [n, x] = g;
          if (n === 3 && x.kind === "varint") modelType = x.v;
          else if (n === 35 && x.kind === "varint") sp.byteFallback = x.v !== 0;
        }
      } else if (num === 3 && field.kind === "bytes") {
        const t = new Reader(field.v);
        for (let g = t.next(); g; g = t.next()) {
          const [n, x] = g;
          if (n === 1 && x.kind === "bytes") normalizer = utf8.decode(x.v);
          else if (n === 2 && x.kind === "bytes") charsmap = x.v.length > 0;
          else if (n === 3 && x.kind === "varint") sp.addDummyPrefix = x.v !== 0;
          else if (n === 4 && x.kind === "varint") sp.removeExtraWhitespaces = x.v !== 0;
          else if (n === 5 && x.kind === "varint") sp.escapeWhitespaces = x.v !== 0;
        }
      }
    }
    if (modelType !== MODEL_BPE) throw new Error(`only BPE sentencepiece models are supported (model_type ${modelType})`);
    if (charsmap || normalizer !== "identity") throw new Error(`only the identity normaliser is supported (got ${JSON.stringify(normalizer)})`);
    // Longest first (by UTF-8 length, stable), so the greedy prefix match prefers the longest symbol.
    const blen = (s: string) => Buffer.byteLength(s);
    sp.userDefined.sort((a, b) => blen(b) - blen(a));
    return sp;
  }

  private normalize(text: string): string {
    let s = this.removeExtraWhitespaces
      ? text
          .split(" ")
          .filter((w) => w)
          .join(" ")
      : text;
    if (this.addDummyPrefix && s) s = ` ${s}`;
    if (this.escapeWhitespaces) s = s.replaceAll(" ", "▁");
    return s;
  }

  private pieceToId(piece: string): number | undefined {
    return this.reserved.get(piece) ?? this.pieces.get(piece)?.id;
  }

  /** `SentencePieceProcessor.Encode(text)`: ids without BOS/EOS. */
  encode(text: string): number[] {
    const norm = this.normalize(text);
    // Symbols over code units of `norm`: start, len, prev, next, freeze.
    const start: number[] = [];
    const len: number[] = [];
    const prev: number[] = [];
    const next: number[] = [];
    const freeze: boolean[] = [];
    let at = 0;
    while (at < norm.length) {
      const user = this.userDefined.find((u) => norm.startsWith(u, at));
      const l = user ? user.length : String.fromCodePoint(norm.codePointAt(at)!).length;
      const i = start.length;
      start.push(at);
      len.push(l);
      prev.push(i - 1);
      next.push(at + l < norm.length ? i + 1 : -1);
      freeze.push(!!user);
      at += l;
    }
    const agenda = new Agenda();
    // merged piece -> [left, right] text, for resegmenting UNUSED pieces.
    const revMerge = new Map<string, [string, string]>();
    const maybeAdd = (left: number, right: number) => {
      if (left < 0 || right < 0 || freeze[left] || freeze[right]) return;
      const piece = norm.slice(start[left], start[left] + len[left] + len[right]);
      const p = this.pieces.get(piece);
      if (!p) return;
      agenda.push({ score: p.score, left, right, size: piece.length });
      if (p.type === UNUSED) {
        revMerge.set(piece, [norm.slice(start[left], start[left] + len[left]), norm.slice(start[right], start[right] + len[right])]);
      }
    };
    for (let i = 1; i < start.length; i++) maybeAdd(i - 1, i);
    for (let top = agenda.pop(); top; top = agenda.pop()) {
      const { left, right } = top;
      if (len[left] === 0 || len[right] === 0 || len[left] + len[right] !== top.size) continue;
      const nx = next[right];
      len[left] += len[right];
      next[left] = nx;
      if (nx >= 0) prev[nx] = left;
      len[right] = 0;
      maybeAdd(prev[left], left);
      maybeAdd(left, nx);
    }
    const ids: number[] = [];
    for (let i = start.length ? 0 : -1; i >= 0; i = next[i]) this.resegment(norm.slice(start[i], start[i] + len[i]), revMerge, ids);
    return ids;
  }

  private resegment(w: string, revMerge: Map<string, [string, string]>, ids: number[]) {
    if (this.pieces.get(w)?.type === UNUSED) {
      const split = revMerge.get(w);
      if (split) {
        this.resegment(split[0], revMerge, ids);
        this.resegment(split[1], revMerge, ids);
        return;
      }
    }
    const id = this.pieceToId(w);
    if (id !== undefined && id !== this.unkId) ids.push(id);
    else if (this.byteFallback) {
      for (const b of new TextEncoder().encode(w)) {
        ids.push(this.pieceToId(`<0x${b.toString(16).toUpperCase().padStart(2, "0")}>`) ?? this.unkId);
      }
    } else ids.push(this.unkId);
  }
}
