// In-process OCR (port of lp_ml::ocr::inprocess, i.e. the sidecar's
// service/ocr). Contract: `POST /ocr {image_path, min_confidence=0.6,
// max_side?, det_only?}` -> {text, blocks, image_width, image_height,
// mean_confidence, text_area_fraction}; a missing or undecodable image is a
// 400. The Python sidecar always loads ppocrv6_small and ignores the
// OCR_MODEL site setting; the port (like librephotos-rs) uses the selected
// bundle. Decoding happens outside the slot, so the next photos decode
// while the models run.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { MlFailed } from "../errors";
import { dataModels, modelSlot, MlUnavailable } from "../runtime";
import { BUNDLE_FILES, OCR_MODELS } from "./config";
import { DecodeError, readImage } from "./decode";
import { Engine, blockJson, defaultOptions, type Options, type Prediction } from "./ppocr";

/** Set once the port passes its goldens; `auto` mode then uses it. */
export const IMPLEMENTED = true;

const notSelected = (v: string) => {
  const t = v.trim();
  return !t || t.toLowerCase() === "none";
};

/** The bundle directory of `model` when it is fully installed. */
export function installedBundle(model: string): string | null {
  const rel = OCR_MODELS[model];
  if (!rel) return null;
  const dir = path.join(dataModels(), rel);
  return BUNDLE_FILES.every((f) => existsSync(path.join(dir, f))) ? dir : null;
}

/** The selected bundle's directory, or why OCR cannot run. */
function bundle(model: string): string {
  if (notSelected(model)) throw new MlUnavailable("no OCR model selected");
  const rel = OCR_MODELS[model];
  if (!rel) throw new MlUnavailable(`unknown OCR model ${JSON.stringify(model)}`);
  const dir = installedBundle(model);
  if (!dir) throw new MlUnavailable(`OCR model ${model} is not installed (${path.join(dataModels(), rel)})`);
  return dir;
}

/**
 * `LP_OCR_PREPASS`: detection side of a cheap text check before full OCR. A
 * photo whose detection at this side finds no text box gets an empty result
 * without the full-size detection and the recognition. Unset or 0 = off.
 */
function prepassSide(): number | null {
  const n = Number.parseInt((process.env.LP_OCR_PREPASS ?? "").trim(), 10);
  return Number.isInteger(n) && n >= 64 ? n : null;
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The whole `/ocr` request (`min_confidence`, `max_side`, `det_only` as the sidecar takes them) with model `model`. */
export async function predict(imagePath: string, model: string, opts: Options = defaultOptions()): Promise<Prediction> {
  // A missing file is bad input, rejected before paying the model load.
  if (!isFile(imagePath)) throw new MlFailed(400, "Image not found");
  const dir = bundle(model);
  let img;
  try {
    img = await readImage(imagePath);
  } catch (e) {
    if (e instanceof DecodeError) {
      console.warn(`ocr: could not decode image ${imagePath}: ${e.message}`);
      throw new MlFailed(400, "Failed to decode image");
    }
    throw e;
  }
  const slot = modelSlot<Engine>("ocr", model, () => Engine.load(dir), (e) => e.release());
  const prepass = prepassSide();
  try {
    return await slot.run(async (engine) => {
      if (prepass !== null && !opts.detOnly) {
        const [boxes] = await engine.detect(img, prepass);
        // No text at the coarse size: an empty result.
        if (!boxes.length) return engine.finish(img, [], opts);
      }
      return engine.predictImage(img, opts);
    });
  } catch (e) {
    if (e instanceof MlUnavailable || e instanceof MlFailed) throw e;
    console.warn(`ocr failed for ${imagePath} (model ${model}): ${(e as Error).message}`);
    throw new MlFailed(500, (e as Error).message);
  }
}

/** What the sidecar's /ocr answers with bundle `model` (the OCR_MODEL setting), for `ocr.generate`. */
export async function ocr(imagePath: string, model: string, minConfidence: number): Promise<OcrAnswer> {
  const p = await predict(imagePath, model, { ...defaultOptions(), minConfidence });
  return {
    text: p.text,
    blocks: p.blocks.map(blockJson),
    text_area_fraction: p.textAreaFraction,
    mean_confidence: p.meanConfidence,
    image_width: p.imageWidth,
    image_height: p.imageHeight,
  };
}

export interface OcrAnswer {
  text: string;
  blocks: ReturnType<typeof blockJson>[];
  text_area_fraction: number;
  mean_confidence: number;
  image_width: number;
  image_height: number;
}
