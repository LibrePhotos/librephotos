// `np.load` / `np.save` for the little-endian float arrays of the tag
// embedding cache (`tag_embeddings.npy`, shared with the Python taggers and
// librephotos-rs; port of lp_ml::tags::npy).
import { readFileSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

/** The value text of `'key': value` in the header dict (a tuple for shape). */
function dictValue(header: string, key: string): string | null {
  let at = header.indexOf(`'${key}'`);
  if (at < 0) at = header.indexOf(`"${key}"`);
  if (at < 0) return null;
  let rest = header.slice(at + key.length + 2).trimStart();
  if (!rest.startsWith(":")) return null;
  rest = rest.slice(1).trimStart();
  if (rest.startsWith("(")) {
    const end = rest.indexOf(")");
    return end < 0 ? null : rest.slice(0, end + 1);
  }
  const m = rest.search(/[,}]/);
  return m < 0 ? rest : rest.slice(0, m);
}

/** A C-order float array as f32 (`<f4`, or `<f8` narrowed). */
export function parseF32(bytes: Uint8Array): { shape: number[]; data: Float32Array } {
  if (bytes.length < 10 || MAGIC.some((v, i) => bytes[i] !== v)) throw new Error("not an .npy file");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let len: number;
  let start: number;
  if (bytes[6] === 1) {
    len = dv.getUint16(8, true);
    start = 10;
  } else if ((bytes[6] === 2 || bytes[6] === 3) && bytes.length >= 12) {
    len = dv.getUint32(8, true);
    start = 12;
  } else throw new Error(`unsupported .npy version ${bytes[6]}`);
  if (start + len > bytes.length) throw new Error("truncated .npy header");
  const header = new TextDecoder().decode(bytes.subarray(start, start + len));
  const descr = dictValue(header, "descr")?.replace(/^['"]|['"]$/g, "");
  if (!descr) throw new Error(".npy header has no descr");
  if (dictValue(header, "fortran_order")?.trim() === "True") throw new Error("Fortran-order arrays are not supported");
  const shapeText = dictValue(header, "shape");
  if (!shapeText) throw new Error(".npy header has no shape");
  const shape = shapeText
    .trim()
    .replace(/^\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (!/^\d+$/.test(s)) throw new Error("bad .npy shape");
      return Number(s);
    });
  const count = shape.reduce((a, b) => a * b, 1);
  if (!Number.isSafeInteger(count)) throw new Error("bad .npy shape");
  const body = start + len;
  const width = descr.endsWith("f4") && ["<", "=", "|"].includes(descr[0]) ? 4 : descr === "<f8" || descr === "=f8" ? 8 : 0;
  if (!width) throw new Error(`unsupported .npy dtype ${descr}`);
  if (count * width > bytes.length - body) throw new Error("truncated .npy data");
  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) data[i] = width === 4 ? dv.getFloat32(body + i * 4, true) : dv.getFloat64(body + i * 8, true);
  return { shape, data };
}

export function readF32(file: string) {
  return parseF32(readFileSync(file));
}

/**
 * `np.save(path, array)` of a C-order f32 array (format 1.0), written to a
 * temporary file and renamed so a concurrent reader never sees half of it.
 */
export function writeF32(file: string, shape: number[], data: Float32Array): void {
  if (shape.reduce((a, b) => a * b, 1) !== data.length) throw new Error("npy shape");
  const dims = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(", ")})`;
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': ${dims}, }`;
  // Magic (6) + version (2) + length (2) + header + '\n', padded to 64.
  const unpadded = 10 + header.length + 1;
  header += " ".repeat(Math.ceil(unpadded / 64) * 64 - unpadded) + "\n";
  const out = new Uint8Array(10 + header.length + data.length * 4);
  out.set(MAGIC);
  out[6] = 1;
  out[7] = 0;
  const dv = new DataView(out.buffer);
  dv.setUint16(8, header.length, true);
  out.set(new TextEncoder().encode(header), 10);
  const body = 10 + header.length;
  for (let i = 0; i < data.length; i++) dv.setFloat32(body + i * 4, data[i], true);
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, out);
  renameSync(tmp, file);
}
