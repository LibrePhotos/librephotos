// Just enough of an ONNX file's protobuf to route it like insightface's
// ModelRouter (input shape, output count) and ArcFaceONNX (the names of the
// first graph nodes) without a session. Port of lp_ml::face::onnx_meta:
// initializers are skipped by seeking, so a 250 MB model costs a few reads.
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** One input dimension: a fixed size, or null when symbolic / unknown. */
export type Dim = number | null;

export interface ModelInfo {
  /** Graph inputs that are not initializers: (name, dims). */
  inputs: [string, Dim[]][];
  outputs: number;
  /** Names of the first 8 nodes. */
  firstNodes: string[];
}

/** `input_shape[i]` of the first input, null when symbolic or missing. */
export function inputDim(info: ModelInfo, i: number): number | null {
  return info.inputs[0]?.[1][i] ?? null;
}

const NODES_KEPT = 8;
const BUF = 1 << 16;

class Reader {
  pos = 0;
  private buf = Buffer.alloc(BUF);
  private bufStart = 0;
  private bufLen = 0;
  constructor(
    private fd: number,
    readonly len: number,
  ) {}

  byte(): number {
    if (this.pos < this.bufStart || this.pos >= this.bufStart + this.bufLen) {
      this.bufStart = this.pos;
      this.bufLen = readSync(this.fd, this.buf, 0, BUF, this.pos);
      if (this.bufLen <= 0) throw new Error("truncated ONNX file");
    }
    return this.buf[this.pos++ - this.bufStart];
  }

  varint(): number {
    let v = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      const b = this.byte();
      v += (b & 0x7f) * mul;
      if (!(b & 0x80)) return v;
      mul *= 128;
    }
    throw new Error("bad varint in ONNX file");
  }

  key(): [number, number] {
    const k = this.varint();
    return [Math.floor(k / 8), k % 8];
  }

  lenEnd(): number {
    const n = this.varint();
    const e = this.pos + n;
    if (!Number.isSafeInteger(e)) throw new Error("bad field length in ONNX file");
    return e;
  }

  string(): string {
    const n = this.varint();
    if (n > 1 << 20) throw new Error("implausible string length in ONNX file");
    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i++) out[i] = this.byte();
    return out.toString("utf8");
  }

  /** Forward only: a corrupt length must not send the parser back. */
  seekTo(end: number) {
    if (end < this.pos) throw new Error("bad field length in ONNX file");
    this.pos = end;
  }

  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.seekTo(this.pos + 8);
    else if (wire === 2) this.seekTo(this.lenEnd());
    else if (wire === 5) this.seekTo(this.pos + 4);
    else throw new Error(`unsupported protobuf wire type ${wire} in ONNX file`);
  }
}

export function readModelInfo(path: string): ModelInfo {
  const fd = openSync(path, "r");
  try {
    const len = fstatSync(fd).size;
    const r = new Reader(fd, len);
    const info: ModelInfo = { inputs: [], outputs: 0, firstNodes: [] };
    const raw: [string, Dim[]][] = [];
    const initializers = new Set<string>();
    while (r.pos < len) {
      const [field, wire] = r.key();
      if (field === 7 && wire === 2) parseGraph(r, r.lenEnd(), info, raw, initializers);
      else r.skip(wire);
    }
    info.inputs = raw.filter(([n]) => !initializers.has(n));
    return info;
  } finally {
    closeSync(fd);
  }
}

function parseGraph(r: Reader, end: number, info: ModelInfo, inputs: [string, Dim[]][], initializers: Set<string>) {
  let nodes = 0;
  while (r.pos < end) {
    const [field, wire] = r.key();
    if (field === 1 && wire === 2) {
      const e = r.lenEnd();
      if (nodes < NODES_KEPT) {
        let name = "";
        while (r.pos < e) {
          const [f, w] = r.key();
          if (f === 3 && w === 2) name = r.string();
          else r.skip(w);
        }
        info.firstNodes.push(name);
      } else r.seekTo(e);
      nodes++;
    } else if (field === 5 && wire === 2) {
      const e = r.lenEnd();
      while (r.pos < e) {
        const [f, w] = r.key();
        if (f === 8 && w === 2) initializers.add(r.string());
        else r.skip(w);
      }
    } else if (field === 11 && wire === 2) {
      inputs.push(parseValueInfo(r, r.lenEnd()));
    } else if (field === 12 && wire === 2) {
      r.seekTo(r.lenEnd());
      info.outputs++;
    } else r.skip(wire);
  }
}

/** ValueInfoProto: name = 1, type = 2 (tensor_type = 1 -> shape = 2 -> dim = 1 -> dim_value = 1 | dim_param = 2). */
function parseValueInfo(r: Reader, end: number): [string, Dim[]] {
  let name = "";
  const dims: Dim[] = [];
  const nested = (stop: number, field: number, inner: (e: number) => void) => {
    while (r.pos < stop) {
      const [f, w] = r.key();
      if (f === field && w === 2) inner(r.lenEnd());
      else r.skip(w);
    }
  };
  while (r.pos < end) {
    const [f, w] = r.key();
    if (f === 1 && w === 2) name = r.string();
    else if (f === 2 && w === 2) {
      nested(r.lenEnd(), 1, (tensorEnd) =>
        nested(tensorEnd, 2, (shapeEnd) =>
          nested(shapeEnd, 1, (dimEnd) => {
            let dim: Dim = null;
            while (r.pos < dimEnd) {
              const [f2, w2] = r.key();
              if (f2 === 1 && w2 === 0) {
                // A negative int64 (-1) is a 10-byte varint.
                const v = r.varint();
                dim = v > Number.MAX_SAFE_INTEGER ? -1 : v;
              }
              else r.skip(w2);
            }
            dims.push(dim);
          }),
        ),
      );
    } else r.skip(w);
  }
  return [name, dims];
}
