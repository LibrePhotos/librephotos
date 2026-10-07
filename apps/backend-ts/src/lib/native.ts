// Native packages, loaded on first use. Start's server build puts every
// route in one chunk that is evaluated at boot, so a static `import sharp`
// anywhere costs an idle server libvips (and ExifTool, ONNX Runtime) whether
// or not a request ever needs it.
//
// The loaders also work in the AOT executable (`bun build --compile`): there
// the bundle's own module root is virtual, so the packages are required from
// the real node_modules next to the executable (dist/ -> ..) or LP_APP_DIR.
import { createRequire } from "node:module";
import path from "node:path";
import type * as SharpNs from "sharp";
import type * as ExiftoolNs from "exiftool-vendored";
import type * as OrtNs from "onnxruntime-node";

const compiled = import.meta.dir.includes("~BUN");

function requireReal<T>(name: string): T {
  const base = process.env.LP_APP_DIR ?? path.dirname(process.execPath);
  return createRequire(path.join(base, "noop.js"))(name) as T;
}

type SharpFn = typeof SharpNs.default;
let sharpP: Promise<SharpFn> | null = null;

/** sharp (libvips), configured once: no cache, LP_VIPS_CONCURRENCY threads per op (1). */
export function loadSharp(): Promise<SharpFn> {
  sharpP ??= (compiled ? Promise.resolve(requireReal<SharpFn>("sharp")) : import("sharp").then((m) => m.default)).then((s) => {
    s.cache(false);
    const n = Number(process.env.LP_VIPS_CONCURRENCY ?? 1);
    s.concurrency(Number.isInteger(n) && n >= 0 && n <= 256 ? n : 1);
    return s;
  });
  return sharpP;
}

let exiftoolP: Promise<typeof ExiftoolNs> | null = null;
export function loadExiftool(): Promise<typeof ExiftoolNs> {
  exiftoolP ??= compiled ? Promise.resolve(requireReal<typeof ExiftoolNs>("exiftool-vendored")) : import("exiftool-vendored");
  return exiftoolP;
}

let ortP: Promise<typeof OrtNs> | null = null;
export function loadOrt(): Promise<typeof OrtNs> {
  ortP ??= compiled ? Promise.resolve(requireReal<typeof OrtNs>("onnxruntime-node")) : import("onnxruntime-node");
  return ortP;
}
