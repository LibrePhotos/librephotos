// A PP-OCRv6 bundle (`det.onnx`, `rec.onnx`, `charset.txt`, `config.json`),
// parsed like ppocr/config.py (port of lp_ml::ocr::ppocr::config).
import { readFileSync } from "node:fs";
import path from "node:path";

/** The OCR bundles of the model catalog: name -> directory under data_models. */
export const OCR_MODELS: Record<string, string> = {
  ppocrv6_tiny: "ocr/ppocrv6_tiny",
  ppocrv6_small: "ocr/ppocrv6_small",
  ppocrv6_medium: "ocr/ppocrv6_medium",
};

/** The files a complete (not half-extracted) bundle has. */
export const BUNDLE_FILES = ["det.onnx", "rec.onnx", "charset.txt", "config.json"];

export interface OcrConfig {
  dir: string;
  detMean: [number, number, number];
  detStd: [number, number, number];
  detScale: number;
  /** `img_mode: RGB` (the bundles say BGR, cv2's own order). */
  detRgb: boolean;
  detMaxSide: number;
  detSizeMultiple: number;
  /** f32: numpy 2 compares the f32 map against the threshold as f32. */
  detThresh: number;
  detBoxThresh: number;
  detUnclipRatio: number;
  detMaxCandidates: number;
  /** [C, H, W]. */
  recInputShape: [number, number, number];
  useSpaceChar: boolean;
  charset: string[];
}

const f = Math.fround;

function triple(v: unknown, what: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`det.preprocess.${what} must have 3 values`);
  return [f(v[0]), f(v[1]), f(v[2])];
}

/**
 * `readlines()` in text mode with only the line ending stripped (an entry
 * may be a single space); a blank last line is dropped.
 */
export function loadCharset(text: string): string[] {
  const t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\n") {
      out.push(t.slice(start, i));
      start = i + 1;
    }
  }
  if (start < t.length) out.push(t.slice(start));
  if (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

export function loadConfig(dir: string): OcrConfig {
  const cfgPath = path.join(dir, "config.json");
  const raw = JSON.parse(readFileSync(cfgPath, "utf8"));
  const pre = raw?.det?.preprocess;
  const post = raw?.det?.postprocess;
  if (!pre || !post) throw new Error(`parsing ${cfgPath}: missing det.preprocess / det.postprocess`);
  const shape = (raw?.rec?.input_shape ?? []) as number[];
  if (shape.length !== 3) throw new Error(`rec.input_shape must be [C, H, W]; got ${JSON.stringify(shape)}`);
  const charsetPath = path.join(dir, "charset.txt");
  const charset = loadCharset(readFileSync(charsetPath, "utf8"));
  if (!charset.length) throw new Error(`empty charset at ${charsetPath}`);
  return {
    dir,
    detMean: triple(pre.mean, "mean"),
    detStd: triple(pre.std, "std"),
    detScale: f(pre.scale),
    detRgb: typeof pre.img_mode === "string" && pre.img_mode.toUpperCase() === "RGB",
    detMaxSide: Math.trunc(pre.max_side),
    detSizeMultiple: Math.trunc(pre.size_multiple),
    detThresh: f(post.thresh),
    detBoxThresh: post.box_thresh,
    detUnclipRatio: post.unclip_ratio,
    detMaxCandidates: Math.trunc(post.max_candidates),
    recInputShape: [Math.trunc(shape[0]), Math.trunc(shape[1]), Math.trunc(shape[2])],
    useSpaceChar: Boolean(raw.use_space_char),
    charset,
  };
}

/**
 * `build_decode_charset`: index 0 is the CTC blank; a head two wider than
 * the charset carries a trailing space class. Any other width would shift
 * every character, so it refuses.
 */
export function decodeCharset(cfg: OcrConfig, recOutputDim: number): string[] {
  const n = cfg.charset.length;
  const extra = recOutputDim - n;
  if (extra !== 1 && extra !== 2) {
    throw new Error(
      `recognition model output width (${recOutputDim}) does not match charset size (${n}); expected ${n + 1} or ${n + 2}. ` +
        "This indicates a tier/charset mismatch which would shift every decoded character by one - refusing to start.",
    );
  }
  const out = ["<blank>", ...cfg.charset];
  if (extra === 2) out.push(" ");
  return out;
}
