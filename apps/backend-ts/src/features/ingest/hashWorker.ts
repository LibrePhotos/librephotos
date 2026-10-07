// Worker thread for the scan's pixel math: pHash (Pillow-exact Lanczos to
// 32x32 + DCT) and the dominant colour. Pure JS, ~15 ms per photo, which
// would otherwise run on the main thread that also drives the DB and
// ExifTool for every file group in flight. Built to dist/hash-worker.js.
import { phashRgb } from "./phash";
import { dominantRgb, formatDominant } from "./color";

export interface HashTask {
  id: number;
  kind: "phash" | "dominant";
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}

export function rgbOf(data: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  if (channels === 3) return data;
  const n = width * height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = i * channels;
    if (channels >= 3) {
      out[i * 3] = data[s];
      out[i * 3 + 1] = data[s + 1];
      out[i * 3 + 2] = data[s + 2];
    } else out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = data[s];
  }
  return out;
}

export function runHashTask(t: Omit<HashTask, "id">): string | null {
  if (t.kind === "phash") {
    return t.channels < 3 ? phashRgb(rgbOf(t.data, t.width, t.height, t.channels), 3, t.width, t.height) : phashRgb(t.data, t.channels, t.width, t.height);
  }
  const rgb = dominantRgb(rgbOf(t.data, t.width, t.height, t.channels), t.width, t.height);
  return rgb ? formatDominant(rgb) : null;
}

declare const self: Worker;
if (typeof Bun !== "undefined" && !Bun.isMainThread) {
  self.onmessage = (e: MessageEvent<HashTask>) => {
    const t = e.data;
    let result: string | null = null;
    let error: string | null = null;
    try {
      result = runHashTask(t);
    } catch (err) {
      error = String(err);
    }
    self.postMessage({ id: t.id, result, error });
  };
}
